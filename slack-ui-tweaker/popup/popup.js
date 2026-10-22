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

  const $ = (id) => document.getElementById(id);
  const els = {
    master: $('master-toggle'),
    contextLine: $('context-line'),
    notice: $('notice'),
    start: $('start-inspector'),
    shortcut: $('shortcut-label'),
    fab: $('fab-toggle'),
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
  };

  for (const slot of document.querySelectorAll('[data-icon]')) slot.replaceWith(icon(slot.dataset.icon, slot.closest('.empty') ? 32 : 16));

  bindEvents();
  await load();
  render();

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
    if (!state.connected || !state.context.teamId) state.filter = 'all';
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
    els.importBtn.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', importRules);
    els.openTab.addEventListener('click', () => chrome.runtime.openOptionsPage());
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

  function flash(text, tone = 'success') {
    state.flash = { text, tone };
    render();
    setTimeout(() => {
      if (state.flash && state.flash.text === text) {
        state.flash = null;
        render();
      }
    }, 4000);
  }

  function showError(error) {
    flash(`Errore: ${(error && error.message) || error}`, 'error');
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
    els.contextLine.title = line;

    const currentAvailable = state.connected && !!state.context.teamId;
    for (const button of els.filters) {
      const pressed = button.dataset.filter === state.filter;
      button.setAttribute('aria-pressed', String(pressed));
      if (button.dataset.filter === 'current') button.disabled = !currentAvailable;
    }
  }

  function renderNotice() {
    let tone = 'info';
    let content = null;
    if (state.flash) {
      tone = state.flash.tone;
      content = [h('span', { class: 'notice-text' }, state.flash.text)];
    } else if (!state.settings.enabled) {
      tone = 'warn';
      content = [h('span', { class: 'notice-text' }, 'Estensione disattivata: le regole non vengono applicate.')];
    } else if (state.isSlack && !state.connected) {
      tone = 'warn';
      content = [
        h('span', { class: 'notice-text' }, 'Questa scheda di Slack è stata aperta prima dell’installazione: ricaricala per attivare l’estensione.'),
        h(
          'button',
          {
            class: 'btn btn-ghost',
            type: 'button',
            onclick: async () => {
              await chrome.tabs.reload(state.tab.id);
              window.close();
            },
          },
          icon('refresh', 14),
          'Ricarica',
        ),
      ];
    } else if (!state.isSlack && !state.inPage) {
      content = [h('span', { class: 'notice-text' }, 'L’ispettore funziona su app.slack.com (scheda o PWA). Da qui puoi comunque gestire tutte le regole.')];
    } else if (state.inPage) {
      content = [h('span', { class: 'notice-text' }, 'Su Slack premi Alt+S o usa il pulsante flottante per avviare l’ispettore.')];
    }
    els.notice.hidden = !content;
    if (content) {
      els.notice.className = `notice ${tone}`;
      els.notice.replaceChildren(...content);
    }
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

  function ruleItem(rule) {
    const meta = C.ACTIONS[rule.action] || C.ACTIONS.custom;
    const canTarget = state.connected && (rule.scope === C.GLOBAL_SCOPE || rule.scope === state.context.teamId);
    const subtitle =
      rule.action === 'custom' && rule.baseAction ? `CSS personalizzato (da «${C.ACTIONS[rule.baseAction].label}»)` : meta.label;

    const toggle = h('input', {
      type: 'checkbox',
      role: 'switch',
      checked: rule.enabled,
      'aria-label': rule.enabled ? 'Disattiva regola' : 'Attiva regola',
      onchange: (event) => storage.setRuleEnabled(rule.id, event.target.checked).catch(showError),
    });

    const deleteButton = h(
      'button',
      { class: 'icon-btn danger', type: 'button', title: 'Elimina regola', 'aria-label': 'Elimina regola' },
      icon('trash', 15),
    );
    if (state.pendingDelete === rule.id) {
      deleteButton.className = 'icon-btn confirm';
      deleteButton.replaceChildren('Elimina?');
    }
    deleteButton.addEventListener('click', async () => {
      if (state.pendingDelete !== rule.id) {
        state.pendingDelete = rule.id;
        renderList();
        setTimeout(() => {
          if (state.pendingDelete === rule.id) {
            state.pendingDelete = null;
            renderList();
          }
        }, CONFIRM_DELETE_MS);
        return;
      }
      state.pendingDelete = null;
      await storage.removeRule(rule.id).catch(showError);
    });

    return h(
      'li',
      { class: `rule${rule.enabled ? '' : ' is-off'}` },
      h(
        'div',
        { class: 'rule-main' },
        h(
          'div',
          { class: 'rule-title' },
          h('span', { class: `badge badge-${rule.action}`, title: subtitle }, icon(meta.icon, 12), meta.short),
          h('span', { class: 'rule-label', title: rule.label || rule.selector }, rule.label || 'Senza nome'),
        ),
        h('code', { class: 'rule-selector', title: rule.selector }, rule.selector),
        h('div', { class: 'rule-meta' }, h('span', { class: 'chip' }, subtitle), matchChip(rule)),
      ),
      h(
        'div',
        { class: 'rule-side' },
        h('label', { class: 'switch small', title: rule.enabled ? 'Regola attiva' : 'Regola disattivata' }, toggle, h('span', { class: 'slider', 'aria-hidden': 'true' })),
        h(
          'div',
          { class: 'rule-actions' },
          h(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              title: canTarget ? 'Evidenzia gli elementi nella pagina' : 'Disponibile nella scheda Slack del workspace',
              'aria-label': 'Evidenzia',
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
              'aria-label': 'Modifica',
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
