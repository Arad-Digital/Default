/**
 * Slack UI Tweaker — popup / dashboard.
 *
 * The same page is used as the toolbar popup and, opened in a tab, as the options page
 * (useful in the Slack PWA window, where the toolbar may be hidden).
 * Rule management works directly on chrome.storage; only the inspector, the match counts and
 * the "highlight"/"edit" buttons need the content script of the active Slack tab.
 */
(async function () {
  'use strict';

  const SUT = window.SUT;
  const C = SUT.constants;
  const storage = SUT.storage;
  const { h, icon } = SUT.dom;

  const SLACK_URL = /^https:\/\/app\.slack\.com\//;
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  const CONFIRM_DELETE_MS = 3000;
  const FLASH_MS = 4000;
  /** Lets the focus change be spoken first and makes a repeated message count as a new one. */
  const ANNOUNCE_DELAY_MS = 150;
  /** Hashes the popup's import button opens the dashboard tab with. */
  const IMPORT_HASH = '#import';
  const IMPORT_REPLACE_HASH = '#import-replace';
  const IMPORT_HINT = 'Per importare le regole premi «Importa JSON» e scegli il file.';

  const $ = (id) => document.getElementById(id);
  const els = {
    master: $('master-toggle'),
    contextLine: $('context-line'),
    notice: $('notice'),
    announcer: $('announcer'),
    start: $('start-inspector'),
    shortcut: $('shortcut-label'),
    fab: $('fab-toggle'),
    rulesTitle: $('rules-title'),
    list: $('rule-list'),
    empty: $('empty-state'),
    count: $('rule-count'),
    filters: Array.from(document.querySelectorAll('[data-filter]')),
    exportBtn: $('export-btn'),
    importBtn: $('import-btn'),
    importFile: $('import-file'),
    importReplace: $('import-replace'),
    openTab: $('open-tab'),
  };

  const state = {
    inPage: false,
    tab: null,
    isSlack: false,
    connected: false,
    /** Response of the content script: { teamId, teamName, matchCounts, … } */
    context: null,
    settings: { ...storage.DEFAULT_SETTINGS },
    rules: {},
    workspaces: {},
    filter: 'current',
    /** Transient feedback (import/export) shown instead of the contextual notice. */
    flash: null,
    pendingDelete: null,
    /** Dashboard tab opened by the popup's import button: the import controls are highlighted. */
    importHint: false,
  };

  let flashSeq = 0;
  let noticeKey = null;
  let deleteTimer = 0;
  let announceTimer = 0;

  for (const slot of document.querySelectorAll('[data-icon]')) slot.replaceWith(icon(slot.dataset.icon, slot.closest('.empty') ? 32 : 16));

  bindEvents();
  try {
    await load();
  } catch (error) {
    // Still render and subscribe below, so the popup recovers on the next storage change.
    showError(error);
  }
  if (!state.connected || !state.context.teamId) state.filter = 'all';
  render();
  handleImportRequest();

  storage.onChange(async (changes) => {
    if (changes.settings) state.settings = changes.settings;
    if (changes.rules) state.rules = changes.rules;
    if (changes.workspaces) state.workspaces = changes.workspaces;
    if (changes.rules) await refreshContext(); // new selectors → new match counts
    render();
  });

  /* ------------------------------------------------------------------ data */

  async function load() {
    state.inPage = Boolean(await chrome.tabs.getCurrent().catch(() => null));
    document.body.classList.toggle('in-page', state.inPage);
    if (!state.inPage) {
      els.importBtn.title = 'Apre la dashboard in una scheda per scegliere il file';
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      state.tab = tab || null;
      state.isSlack = !!(tab && tab.url && SLACK_URL.test(tab.url));
    }
    [state.settings, state.rules, state.workspaces] = await Promise.all([
      storage.getSettings(),
      storage.getRulesByScope(),
      storage.getWorkspaces(),
    ]);
    await refreshContext();
    loadShortcut();
  }

  async function refreshContext() {
    if (!state.isSlack || !state.tab) return;
    try {
      const response = await chrome.tabs.sendMessage(state.tab.id, { type: C.MSG.GET_CONTEXT });
      state.context = response && response.ok ? response : null;
    } catch {
      state.context = null;
    }
    state.connected = !!state.context;
  }

  async function loadShortcut() {
    try {
      const commands = await chrome.commands.getAll();
      const command = commands.find((c) => c.name === C.COMMAND_TOGGLE_INSPECTOR);
      els.shortcut.textContent = command && command.shortcut ? command.shortcut : 'Alt+S';
    } catch {
      // Keep the default label.
    }
  }

  function sendToTab(message) {
    return chrome.tabs.sendMessage(state.tab.id, message);
  }

  function workspaceName(teamId) {
    if (state.context && state.context.teamId === teamId && state.context.teamName) return state.context.teamName;
    const info = state.workspaces[teamId];
    return info && info.name ? info.name : '';
  }

  /* ------------------------------------------------------------------ events */

  function bindEvents() {
    els.master.addEventListener('change', () => {
      storage.updateSettings({ enabled: els.master.checked }).catch(showError);
    });

    els.fab.addEventListener('change', () => {
      storage.updateSettings({ showFloatingButton: els.fab.checked }).catch(showError);
    });

    els.start.addEventListener('click', async () => {
      if (!state.connected) return;
      try {
        await sendToTab({ type: C.MSG.START_INSPECTOR });
        window.close();
      } catch (error) {
        showError(error);
      }
    });

    for (const button of els.filters) {
      button.addEventListener('click', () => {
        state.filter = button.dataset.filter;
        render();
      });
    }

    els.exportBtn.addEventListener('click', exportRules);
    els.importBtn.addEventListener('click', () => {
      if (state.inPage) els.importFile.click();
      else openImportTab();
    });
    els.importFile.addEventListener('change', importRules);
    els.openTab.addEventListener('click', () => chrome.runtime.openOptionsPage().catch(showError));
  }

  /**
   * The native file chooser takes focus away from the popup, which can dismiss it before `change` fires
   * (the import would silently do nothing). So the popup sends the user to the dashboard tab, carrying
   * the "replace" choice in the hash. Not awaited before closing: the new tab may close the popup first.
   */
  function openImportTab() {
    const hash = els.importReplace.checked ? IMPORT_REPLACE_HASH : IMPORT_HASH;
    chrome.tabs.create({ url: chrome.runtime.getURL(`popup/popup.html${hash}`) }).then(() => window.close(), showError);
  }

  /** Dashboard tab opened by openImportTab(): point the user at the import controls (no auto-click, it needs a gesture). */
  function handleImportRequest() {
    if (!state.inPage || ![IMPORT_HASH, IMPORT_REPLACE_HASH].includes(location.hash)) return;
    els.importReplace.checked = location.hash === IMPORT_REPLACE_HASH;
    window.history.replaceState(null, '', location.pathname + location.search); // a reload starts clean
    state.importHint = true;
    els.importBtn.classList.add('is-requested');
    renderNotice();
    els.importBtn.scrollIntoView({ block: 'center' });
    els.importBtn.focus({ preventScroll: true });
    announce(IMPORT_HINT);
  }

  function clearImportHint() {
    state.importHint = false;
    els.importBtn.classList.remove('is-requested');
  }

  async function exportRules() {
    try {
      const data = await storage.exportConfig();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = h('a', { href: url, download: `slack-ui-tweaker-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const total = Object.values(data.rules).reduce((sum, list) => sum + list.length, 0);
      flash(`Esportate ${total} regole.`, 'success');
    } catch (error) {
      showError(error);
    }
  }

  async function importRules() {
    const file = els.importFile.files && els.importFile.files[0];
    els.importFile.value = '';
    if (!file) return;
    clearImportHint();
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('File troppo grande (max 2 MB).');
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('Il file non contiene JSON valido.');
      }
      const { imported, skipped } = await storage.importConfig(data, { replace: els.importReplace.checked });
      flash(`Importate ${imported} regole${skipped ? `, ${skipped} scartate perché non valide` : ''}.`, imported ? 'success' : 'warn');
    } catch (error) {
      showError(error);
    }
  }

  /** Feedback only touches the notice: rebuilding the rule list would move focus around for nothing. */
  function flash(text, tone = 'success') {
    const id = ++flashSeq;
    state.flash = { text, tone, id };
    renderNotice();
    announce(text);
    setTimeout(() => {
      if (state.flash && state.flash.id === id) {
        state.flash = null;
        renderNotice();
      }
    }, FLASH_MS);
  }

  function showError(error) {
    flash(`Errore: ${(error && error.message) || error}`, 'error');
    render(); // a failed write may have left a switch out of step with the stored state
  }

  /**
   * Speaks `text` through #announcer, the page's only live region. #notice is deliberately not live: it
   * is rewritten on context changes, and its static hints would otherwise be read again and again.
   */
  function announce(text) {
    clearTimeout(announceTimer);
    els.announcer.textContent = '';
    announceTimer = setTimeout(() => {
      els.announcer.textContent = text;
    }, ANNOUNCE_DELAY_MS);
  }

  /* ------------------------------------------------------------------ render */

  function render() {
    renderHeader();
    renderNotice();
    renderList();
  }

  function renderHeader() {
    els.master.checked = state.settings.enabled;
    els.fab.checked = state.settings.showFloatingButton;
    els.fab.disabled = !state.settings.enabled;
    els.start.disabled = !state.connected || !state.settings.enabled;

    let line;
    if (state.inPage) line = 'Dashboard regole';
    else if (!state.isSlack) line = 'Apri app.slack.com per usare l’ispettore';
    else if (!state.connected) line = 'Slack rilevato · estensione non ancora attiva';
    else if (state.context.teamId) line = `Workspace: ${workspaceName(state.context.teamId) || state.context.teamId}`;
    else line = 'Slack · workspace non rilevato (solo regole globali)';
    els.contextLine.textContent = line;

    const currentAvailable = state.connected && !!state.context.teamId;
    for (const button of els.filters) {
      const pressed = button.dataset.filter === state.filter;
      button.setAttribute('aria-pressed', String(pressed));
      if (button.dataset.filter === 'current') button.disabled = !currentAvailable;
    }
  }

  /** @returns {{ tone: string, text: string, key: string, action?: () => HTMLElement } | null} */
  function currentNotice() {
    if (state.flash) return { ...state.flash, key: `flash:${state.flash.id}` };
    if (state.importHint) return { tone: 'info', key: 'import', text: IMPORT_HINT };
    if (!state.settings.enabled) {
      return { tone: 'warn', key: 'disabled', text: 'Estensione disattivata: le regole non vengono applicate.' };
    }
    if (state.isSlack && !state.connected) {
      return {
        tone: 'warn',
        key: 'reload',
        text: 'Questa scheda di Slack è stata aperta prima dell’installazione: ricaricala per attivare l’estensione.',
        action: reloadButton,
      };
    }
    if (!state.isSlack && !state.inPage) {
      return { tone: 'info', key: 'not-slack', text: 'L’ispettore funziona su app.slack.com (scheda o PWA). Da qui puoi comunque gestire tutte le regole.' };
    }
    if (state.inPage) return { tone: 'info', key: 'in-page', text: 'Su Slack premi Alt+S o usa il pulsante flottante per avviare l’ispettore.' };
    return null;
  }

  function renderNotice() {
    const notice = currentNotice();
    // Same message as shown: leave the DOM alone, so a focused "Ricarica" button is not replaced under the user.
    const key = notice ? notice.key : '';
    if (key === noticeKey) return;
    noticeKey = key;
    els.notice.hidden = !notice;
    if (!notice) {
      els.notice.replaceChildren();
      return;
    }
    els.notice.className = `notice ${notice.tone}`;
    const children = [h('span', { class: 'notice-text' }, notice.text)];
    if (notice.action) children.push(notice.action());
    els.notice.replaceChildren(...children);
  }

  function reloadButton() {
    return h(
      'button',
      {
        class: 'btn btn-ghost',
        type: 'button',
        onclick: async () => {
          try {
            await chrome.tabs.reload(state.tab.id);
            window.close();
          } catch (error) {
            showError(error);
          }
        },
      },
      icon('refresh', 14),
      'Ricarica',
    );
  }

  /** Scopes to show, in order: global, current workspace, then the others by name. */
  function visibleScopes() {
    const teamId = state.connected ? state.context.teamId : null;
    if (state.filter === 'current' && teamId) return [C.GLOBAL_SCOPE, teamId];
    const others = Object.keys(state.rules)
      .filter((scope) => scope !== C.GLOBAL_SCOPE && scope !== teamId)
      .sort((a, b) => (workspaceName(a) || a).localeCompare(workspaceName(b) || b));
    return [C.GLOBAL_SCOPE, teamId, ...others].filter(Boolean);
  }

  function renderList() {
    const focus = saveListFocus();
    const items = [];
    let total = 0;
    for (const scope of visibleScopes()) {
      const rules = state.rules[scope] || [];
      if (!rules.length) continue;
      total += rules.length;
      items.push(groupHeader(scope), ...rules.map(ruleItem));
    }
    els.list.replaceChildren(...items);
    els.count.textContent = String(total);
    els.empty.hidden = total > 0;
    restoreListFocus(focus);
  }

  /**
   * Every rebuild replaces the focused control. Remember it as rule id + control (its data-focus-key),
   * plus the rule order, to find a sensible replacement if the rule itself is gone.
   * @returns {{ ruleId: string, control: string, order: string[] } | null}
   */
  function saveListFocus() {
    const active = document.activeElement;
    const key = active && els.list.contains(active) ? active.dataset.focusKey : '';
    if (!key) return null;
    const [ruleId, control] = key.split(':');
    const order = Array.from(els.list.querySelectorAll('.rule'), (item) => item.dataset.ruleId);
    return { ruleId, control, order };
  }

  /**
   * Gives focus back after a rebuild so it never drops to <body>: the same control of the same rule (or
   * its switch if that control is now disabled); after a deletion, the same control of the next rule,
   * else of the previous one; with no rules left, the list heading.
   */
  function restoreListFocus(saved) {
    if (!saved) return;
    const controls = new Map();
    for (const node of els.list.querySelectorAll('[data-focus-key]')) {
      if (!node.disabled) controls.set(node.dataset.focusKey, node);
    }
    const pick = (ruleId) => controls.get(`${ruleId}:${saved.control}`) || controls.get(`${ruleId}:switch`);
    const index = saved.order.indexOf(saved.ruleId);
    const nearby = [...saved.order.slice(index + 1), ...saved.order.slice(0, Math.max(index, 0)).reverse()];
    let target = pick(saved.ruleId);
    for (const ruleId of nearby) {
      if (target) break;
      target = pick(ruleId);
    }
    (target || els.rulesTitle).focus();
  }

  function groupHeader(scope) {
    if (scope === C.GLOBAL_SCOPE) return h('li', { class: 'group' }, 'Globali · tutti i workspace');
    const isCurrent = state.connected && state.context.teamId === scope;
    const name = workspaceName(scope);
    return h(
      'li',
      { class: 'group' },
      h('span', null, name || 'Workspace'),
      h('span', { class: 'id' }, scope),
      isCurrent ? h('span', { class: 'tag' }, 'corrente') : null,
    );
  }

  function matchChip(rule) {
    const inView = state.connected && (rule.scope === C.GLOBAL_SCOPE || rule.scope === state.context.teamId);
    if (!inView || !state.context.matchCounts || !(rule.id in state.context.matchCounts)) return null;
    const n = state.context.matchCounts[rule.id];
    if (n < 0) return h('span', { class: 'chip err' }, 'selettore non valido');
    if (n === 0) {
      return h('span', { class: 'chip warn', title: 'Nessun elemento corrispondente è renderizzato ora (le liste di Slack sono virtualizzate)' }, '0 nella vista');
    }
    return h('span', { class: 'chip ok' }, n === 1 ? '1 elemento' : `${n} elementi`);
  }

  /* ------------------------------------------------------------------ delete (two steps) */

  async function onDeleteClick(rule, name) {
    if (state.pendingDelete !== rule.id) {
      state.pendingDelete = rule.id;
      renderList(); // focus comes back to the recreated "Elimina?" button
      announce(`Premi di nuovo per eliminare «${name}».`);
      scheduleDeleteReset();
      return;
    }
    clearTimeout(deleteTimer);
    state.pendingDelete = null;
    try {
      // The storage change re-renders the list; restoreListFocus() then moves focus to a neighbour.
      if (await storage.removeRule(rule.id)) announce(`Regola «${name}» eliminata.`);
      else renderList();
    } catch (error) {
      showError(error); // re-renders: the button leaves its "Elimina?" state
    }
  }

  /** Cancels the pending confirmation after CONFIRM_DELETE_MS, but never while its button has focus. */
  function scheduleDeleteReset() {
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => {
      if (!state.pendingDelete) return;
      const active = document.activeElement;
      if (active && active.dataset && active.dataset.focusKey === `${state.pendingDelete}:delete`) {
        scheduleDeleteReset();
        return;
      }
      state.pendingDelete = null;
      renderList();
    }, CONFIRM_DELETE_MS);
  }

  /* ------------------------------------------------------------------ rule card */

  function ruleItem(rule) {
    const meta = C.ACTIONS[rule.action] || C.ACTIONS.custom;
    const canTarget = state.connected && (rule.scope === C.GLOBAL_SCOPE || rule.scope === state.context.teamId);
    const subtitle =
      rule.action === 'custom' && rule.baseAction ? `CSS personalizzato (da «${C.ACTIONS[rule.baseAction].label}»)` : meta.label;
    // Same text sighted users see; the selector is too long and noisy for a control name.
    const name = rule.label || 'Senza nome';
    const labelId = `rule-label-${rule.id}`;
    const focusKey = (control) => `${rule.id}:${control}`;
    const pendingDelete = state.pendingDelete === rule.id;

    // Named by the visible label; on/off comes from `checked` + role=switch, never from the name.
    const toggle = h('input', {
      type: 'checkbox',
      role: 'switch',
      checked: rule.enabled,
      'aria-labelledby': labelId,
      'data-focus-key': focusKey('switch'),
      onchange: (event) => storage.setRuleEnabled(rule.id, event.target.checked).catch(showError),
    });

    const deleteButton = h(
      'button',
      {
        class: pendingDelete ? 'icon-btn confirm' : 'icon-btn danger',
        type: 'button',
        title: pendingDelete ? 'Premi di nuovo per eliminare' : 'Elimina regola',
        // The name starts with the visible text ("Elimina?") so voice control users can say it.
        'aria-label': pendingDelete ? `Elimina? Conferma l’eliminazione di «${name}»` : `Elimina «${name}»`,
        'data-focus-key': focusKey('delete'),
        // Focus stays on this button across the confirm step: a held Enter must not confirm by auto-repeat.
        onkeydown: (event) => {
          if (event.repeat) event.preventDefault();
        },
        onclick: () => onDeleteClick(rule, name),
      },
      pendingDelete ? 'Elimina?' : icon('trash', 15),
    );

    return h(
      'li',
      { class: `rule${rule.enabled ? '' : ' is-off'}`, 'data-rule-id': rule.id },
      h(
        'div',
        { class: 'rule-main' },
        h(
          'div',
          { class: 'rule-title' },
          h('span', { class: `badge badge-${rule.action}`, title: subtitle }, icon(meta.icon, 12), meta.short),
          h('span', { class: 'rule-label', id: labelId, title: rule.label || rule.selector }, name),
        ),
        h('code', { class: 'rule-selector', title: rule.selector }, rule.selector),
        h('div', { class: 'rule-meta' }, h('span', { class: 'chip' }, subtitle), matchChip(rule)),
      ),
      h(
        'div',
        { class: 'rule-side' },
        h('label', { class: 'switch small', title: 'Attiva o disattiva la regola' }, toggle, h('span', { class: 'slider', 'aria-hidden': 'true' })),
        h(
          'div',
          { class: 'rule-actions' },
          h(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              title: canTarget ? 'Evidenzia gli elementi nella pagina' : 'Disponibile nella scheda Slack del workspace',
              'aria-label': `Evidenzia «${name}»`,
              'data-focus-key': focusKey('flash'),
              disabled: !canTarget,
              onclick: () => sendToTab({ type: C.MSG.FLASH_RULE, ruleId: rule.id }).catch(showError),
            },
            icon('eye', 15),
          ),
          h(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              title: canTarget ? 'Modifica selettore e CSS nella pagina' : 'Disponibile nella scheda Slack del workspace',
              'aria-label': `Modifica «${name}»`,
              'data-focus-key': focusKey('edit'),
              disabled: !canTarget,
              onclick: async () => {
                try {
                  await sendToTab({ type: C.MSG.EDIT_RULE, ruleId: rule.id });
                  window.close();
                } catch (error) {
                  showError(error);
                }
              },
            },
            icon('edit', 15),
          ),
          deleteButton,
        ),
      ),
    );
  }
})();
