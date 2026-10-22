/**
 * Slack UI Tweaker — Inspector Mode (point & click).
 *
 * States: inactive → 'hover' (highlight what is under the cursor) → 'menu' (element selected,
 * contextual actions) → 'editor' (selector/CSS editor). Esc leaves the inspector from any state
 * without saving anything.
 *
 * Event strategy:
 * - Listeners are registered on `window` in the capture phase, at document_start, so they run
 *   before any listener Slack can register. Page listeners exist only while the inspector is active,
 *   except a single keydown listener for the Alt+S shortcut.
 * - While inspecting, pointer/mouse/click events aimed at Slack are cancelled (preventDefault +
 *   stopImmediatePropagation): clicking selects an element instead of triggering Slack.
 * - Hover is never blocked, so Slack's hover-only UI (message actions toolbar…) can be targeted.
 * - Keyboard/clipboard/focus events typed into our panel are stopped at window level, so Slack's
 *   global shortcuts ("type anywhere to focus the composer", Esc = mark as read…) never see them.
 *   Their default action (typing, pasting) still happens.
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});
  const C = SUT.constants;
  const gen = SUT.selectorGenerator;
  const engine = SUT.styleEngine;
  const ui = SUT.ui;
  const { h, icon } = SUT.dom;

  const BLOCKED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];
  const ISOLATED_EVENTS = ['keyup', 'keypress', 'copy', 'cut', 'paste', 'focusin', 'focusout'];
  const MAX_HIGHLIGHTED_MATCHES = 300;
  const TOGGLE_DEBOUNCE_MS = 350;
  const EDITOR_DEBOUNCE_MS = 140;
  const HOVER_HINT = 'Ispettore attivo: clicca un elemento di Slack';

  /** Provided by content.js. */
  const hooks = {
    getTeam: () => ({ id: null, name: '' }),
    isEnabled: () => true,
    enable: () => {},
    addRule: async () => null,
    updateRule: async () => null,
    removeRule: async () => false,
    onActiveChange: () => {},
  };

  const state = {
    active: false,
    /** @type {'hover'|'menu'|'editor'} */
    view: 'hover',
    hoverEl: null,
    baseEl: null,
    /** Elements left when navigating to the parent, to go back down. */
    trail: [],
    /** @type {'unique'|'similar'|'parent'} */
    targeting: 'unique',
    candidates: null,
    /** @type {'workspace'|'global'|null} null = default */
    scope: null,
    anchor: null,
    editor: null,
    refs: null,
    lastToggle: { source: null, at: 0 },
  };

  const compactCache = new WeakMap();
  let pendingHover = null;
  let hoverFrame = 0;
  let viewportFrame = 0;
  let editorTimer = 0;
  let pointer = { x: -1, y: -1 };

  /* ------------------------------------------------------------------ lifecycle */

  function init(callbacks) {
    Object.assign(hooks, callbacks);
    window.addEventListener('keydown', onKeyDown, true);
    for (const type of ISOLATED_EVENTS) window.addEventListener(type, isolateUIEvent, true);
  }

  function isActive() {
    return state.active;
  }

  /** @returns {boolean} whether the inspector is active afterwards */
  function activate() {
    if (state.active) return true;
    if (!document.body) return false;
    if (!hooks.isEnabled()) {
      ui.toast('Slack UI Tweaker è disattivato: le regole non sono applicate.', {
        tone: 'warn',
        actionLabel: 'Riattiva',
        onAction: () => hooks.enable(),
      });
      return false;
    }
    ui.mount();
    Object.assign(state, { active: true, view: 'hover', hoverEl: null, baseEl: null, trail: [], scope: null, editor: null, refs: null });
    window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', onViewportChange, { passive: true });
    for (const type of BLOCKED_EVENTS) window.addEventListener(type, onPointerEvent, true);
    setCursor(true);
    ui.banner(HOVER_HINT);
    hooks.onActiveChange(true);
    return true;
  }

  function deactivate() {
    if (!state.active) return;
    const editedRuleId = state.editor && state.editor.ruleId;
    state.active = false;
    window.removeEventListener('mousemove', onMouseMove, { capture: true });
    window.removeEventListener('scroll', onViewportChange, { capture: true });
    window.removeEventListener('resize', onViewportChange);
    for (const type of BLOCKED_EVENTS) window.removeEventListener(type, onPointerEvent, true);
    cancelAnimationFrame(hoverFrame);
    cancelAnimationFrame(viewportFrame);
    clearTimeout(editorTimer);
    hoverFrame = viewportFrame = editorTimer = 0;
    engine.clearPreview();
    if (editedRuleId) engine.suspend(null);
    Object.assign(state, { view: 'hover', hoverEl: null, baseEl: null, trail: [], candidates: null, editor: null, refs: null });
    ui.panel.close();
    ui.tooltip.hide();
    ui.banner(null);
    ui.highlighter.clear();
    setCursor(false);
    hooks.onActiveChange(false);
  }

  /**
   * @param {'keyboard'|'command'|'fab'|'other'} [source]
   * @returns {boolean} whether the inspector is active afterwards
   */
  function toggle(source = 'other') {
    const now = Date.now();
    // One Alt+S press can reach us twice: the in-page key listener and the extension command
    // relayed by the service worker. Only that pair is debounced; repeated presses are honoured.
    const last = state.lastToggle;
    const echoed = (source === 'keyboard' && last.source === 'command') || (source === 'command' && last.source === 'keyboard');
    if (echoed && now - last.at < TOGGLE_DEBOUNCE_MS) return state.active;
    state.lastToggle = { source, at: now };
    if (state.active) {
      deactivate();
      return false;
    }
    return activate();
  }

  function setCursor(on) {
    let el = document.getElementById(C.CURSOR_STYLE_ELEMENT_ID);
    if (!on) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = C.CURSOR_STYLE_ELEMENT_ID;
      el.textContent = 'html, html * { cursor: crosshair !important; }';
    }
    (document.head || document.documentElement).appendChild(el);
  }

  /* ------------------------------------------------------------------ keyboard */

  function isShortcut(event) {
    return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyS';
  }

  function onKeyDown(event) {
    if (isShortcut(event) && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle('keyboard');
      return;
    }
    if (!state.active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      deactivate();
      return;
    }
    if (!ui.isFromUI(event)) return;
    // Typing in our panel: keep Slack's global shortcuts out (the character is still inserted).
    event.stopImmediatePropagation();
    if (state.view === 'editor' && event.key === 'Enter' && !event.isComposing) {
      const focused = ui.activeElement();
      const submits = focused && (focused.tagName === 'INPUT' || focused.hasAttribute('data-enter-submits'));
      if (event.metaKey || event.ctrlKey || submits) {
        event.preventDefault();
        saveEditor();
      }
    }
  }

  function isolateUIEvent(event) {
    if (state.active && ui.isFromUI(event)) event.stopImmediatePropagation();
  }

  /* ------------------------------------------------------------------ hover & click */

  /** Element worth inspecting under `node`, or null. */
  function resolveTarget(node) {
    let el = node instanceof Element ? node : node && node.parentElement;
    if (!el) return null;
    // Icons: select the whole <svg>, not one of its <path>s.
    while (el.ownerSVGElement) el = el.ownerSVGElement;
    if (el === document.documentElement || el === document.body || el === document.head) return null;
    if (el.closest(`[${C.UI_ATTR}]`)) return null;
    return el;
  }

  function onMouseMove(event) {
    pointer = { x: event.clientX, y: event.clientY };
    if (state.view !== 'hover') return;
    pendingHover = ui.isFromUI(event) ? null : resolveTarget(event.target);
    if (!hoverFrame) hoverFrame = requestAnimationFrame(applyHover);
  }

  function applyHover() {
    hoverFrame = 0;
    if (!state.active || state.view !== 'hover' || pendingHover === state.hoverEl) return;
    state.hoverEl = pendingHover;
    if (!pendingHover) {
      ui.highlighter.clear();
      ui.tooltip.hide();
      return;
    }
    ui.highlighter.setPrimary(pendingHover, 'primary');
    ui.tooltip.show(pendingHover, gen.describe(pendingHover));
  }

  function onViewportChange() {
    if (viewportFrame) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      if (!state.active) return;
      if (state.view === 'hover') {
        // Content moved under a still cursor: re-pick the element there.
        state.hoverEl = null;
        pendingHover = pointer.x < 0 ? null : resolveTarget(document.elementFromPoint(pointer.x, pointer.y));
        applyHover();
      } else {
        ui.highlighter.refresh();
        ui.panel.clamp();
      }
    });
  }

  function onPointerEvent(event) {
    if (ui.isFromUI(event)) return; // our own panel handles its events
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'contextmenu') {
      if (state.view === 'menu') backToHover();
      return;
    }
    if (event.type !== 'click' || event.button !== 0) return;
    if (state.view === 'hover') {
      const target = resolveTarget(event.target);
      if (target) select(target, event.clientX, event.clientY);
      else ui.toast('Seleziona un elemento più specifico.', { tone: 'warn', duration: 1800 });
    } else if (state.view === 'menu') {
      backToHover();
    }
    // In the editor, clicks on the page are ignored so unsaved edits are not lost.
  }

  function backToHover() {
    engine.clearPreview();
    Object.assign(state, { view: 'hover', hoverEl: null, baseEl: null, trail: [], candidates: null, editor: null, refs: null });
    ui.panel.close();
    ui.highlighter.clear();
    ui.banner(HOVER_HINT);
  }

  /* ------------------------------------------------------------------ selection */

  function usableParent(el) {
    const parent = el && el.parentElement;
    return parent && parent !== document.body && parent !== document.documentElement ? parent : null;
  }

  function select(el, x, y) {
    Object.assign(state, { view: 'menu', baseEl: el, trail: [], anchor: { x, y } });
    ui.tooltip.hide();
    ui.banner(null);
    updateBase(true);
  }

  function updateBase(resetTargeting) {
    const el = state.baseEl;
    const parentEl = usableParent(el);
    const unique = gen.uniqueSelector(el);
    const similar = gen.similarSelector(el);
    const parent = parentEl ? { ...gen.uniqueSelector(parentEl), el: parentEl } : null;
    state.candidates = { unique, similar, parent };
    if (resetTargeting) {
      // A structural (fragile) path rarely survives Slack re-renders: prefer "similar" when it exists.
      state.targeting = unique.fragile && similar.similar ? 'similar' : 'unique';
    }
    if (state.targeting === 'parent' && !parent) state.targeting = 'unique';
    if (state.targeting === 'similar' && !similar.similar) state.targeting = 'unique';
    renderMenu();
    highlightCandidate();
  }

  function currentCandidate() {
    if (!state.candidates) return null;
    return state.candidates[state.targeting] || state.candidates.unique;
  }

  /** Element the current targeting refers to (used for labels and measurements). */
  function targetElement() {
    if (state.targeting === 'parent' && state.candidates && state.candidates.parent) return state.candidates.parent.el;
    return state.baseEl;
  }

  function highlightCandidate() {
    const candidate = currentCandidate();
    ui.highlighter.setPrimary(targetElement(), 'selected');
    ui.highlighter.setMatches(candidate ? gen.queryAll(candidate.selector, MAX_HIGHLIGHTED_MATCHES) : []);
  }

  function goUp() {
    const parent = usableParent(state.baseEl);
    if (!parent) return;
    state.trail.push(state.baseEl);
    state.baseEl = parent;
    if (state.targeting === 'parent') state.targeting = 'unique';
    engine.clearPreview();
    updateBase(false);
  }

  function goDown() {
    const child = state.trail.pop() || state.baseEl.firstElementChild;
    if (!child) return;
    state.baseEl = child;
    engine.clearPreview();
    updateBase(false);
  }

  /* ------------------------------------------------------------------ rule defaults */

  function effectiveScope() {
    const team = hooks.getTeam();
    if (!team.id) return 'global';
    return state.scope || 'workspace';
  }

  function scopeKey() {
    return effectiveScope() === 'workspace' ? hooks.getTeam().id : C.GLOBAL_SCOPE;
  }

  /** Halved padding/margin/gap of `el`, measured once (before any preview is applied). */
  function measureCompact(el) {
    if (!el) return null;
    if (compactCache.has(el)) return compactCache.get(el);
    const style = getComputedStyle(el);
    const half = (properties) => {
      const values = properties.map((p) => parseFloat(style.getPropertyValue(p)));
      if (values.some((v) => !Number.isFinite(v))) return null;
      return values.map((v) => `${Math.round(v * 5) / 10}px`).join(' ');
    };
    const out = {};
    const padding = half(['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
    const margin = half(['margin-top', 'margin-right', 'margin-bottom', 'margin-left']);
    if (padding) out.padding = padding;
    if (margin) out.margin = margin;
    if (/flex|grid/.test(style.display)) {
      const gaps = ['row-gap', 'column-gap'].map((p) => parseFloat(style.getPropertyValue(p)));
      if (gaps.every(Number.isFinite) && gaps.some((v) => v > 0)) out.gap = gaps.map((v) => `${Math.round(v * 5) / 10}px`).join(' ');
    }
    const values = Object.keys(out).length ? out : null;
    compactCache.set(el, values);
    return values;
  }

  function isInsideHoverContainer(el) {
    return !!(el && el.parentElement && el.parentElement.closest(C.HOVER_CONTAINERS.join(',')));
  }

  /** @param {string} action @param {Element|null} [el] sample element */
  function defaultOptions(action, el = targetElement()) {
    switch (action) {
      case 'hover':
        return { hoverTarget: isInsideHoverContainer(el) ? 'container' : 'parent', hoverAncestor: '' };
      case 'fade':
        return { opacity: 0.2, restoreOnHover: true };
      case 'compact':
        return { compactMode: 'half', compactValues: measureCompact(el) };
      case 'collapse':
        return { collapsed: true };
      default:
        return {};
    }
  }

  function suggestLabel(el = targetElement()) {
    if (!el) return '';
    const raw =
      el.getAttribute('aria-label') ||
      el.getAttribute('data-qa') ||
      el.getAttribute('data-testid') ||
      el.getAttribute('title') ||
      el.getAttribute('role') ||
      el.localName;
    let text = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (state.targeting === 'similar') text += ' (tutti)';
    return text.slice(0, 80);
  }

  /* ------------------------------------------------------------------ small UI builders */

  function iconButton(name, title, onClick, disabled = false) {
    return h('button', { class: 'icon-btn', type: 'button', title, 'aria-label': title, disabled, onclick: onClick }, icon(name, 15));
  }

  function segmented(options, value, onChange) {
    return h(
      'div',
      { class: 'segmented', role: 'group' },
      options.map((item) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(item.value === value),
            disabled: !!item.disabled,
            title: item.title || null,
            onclick: () => {
              if (item.value !== value) onChange(item.value);
            },
          },
          h('span', null, item.label),
          item.n != null ? h('span', { class: 'n' }, String(item.n)) : null,
        ),
      ),
    );
  }

  function countPill(n) {
    if (n < 0) return h('span', { class: 'pill err' }, icon('alert', 12), 'Selettore non valido');
    if (n === 0) return h('span', { class: 'pill warn', title: 'Nessun elemento corrispondente è visibile ora' }, '0 elementi nella vista');
    return h('span', { class: 'pill ok' }, icon('check', 12), n === 1 ? '1 elemento' : `${n} elementi`);
  }

  function field(label, ...controls) {
    return h('label', { class: 'field' }, h('span', null, label), ...controls);
  }

  function option(value, label, selected) {
    return h('option', { value, selected: value === selected }, label);
  }

  /* ------------------------------------------------------------------ contextual menu */

  function renderMenu() {
    const el = state.baseEl;
    const { similar, parent } = state.candidates;
    const candidate = currentCandidate();
    const team = hooks.getTeam();
    const info = gen.describe(el);

    const head = h(
      'div',
      { class: 'panel-head', 'data-drag-handle': '' },
      h('span', { class: 'tag-chip' }, `<${el.localName}>`),
      h('span', { class: 'head-title mono', title: info.hint || el.localName }, info.hint || 'senza attributi stabili'),
      iconButton('arrowUp', 'Seleziona il genitore', goUp, !usableParent(el)),
      iconButton('arrowDown', 'Torna al figlio', goDown, !state.trail.length && !el.firstElementChild),
      iconButton('close', 'Chiudi (Esc)', deactivate),
    );

    const targeting = h(
      'div',
      { class: 'section' },
      h('span', { class: 'label' }, 'Applica a'),
      segmented(
        [
          { value: 'unique', label: 'Questo elemento', title: 'Solo questo elemento specifico' },
          {
            value: 'similar',
            label: 'Simili',
            n: similar.similar ? similar.count : null,
            disabled: !similar.similar,
            title: similar.similar ? 'Tutti gli elementi simili nel contenitore' : 'Nessun elemento simile trovato',
          },
          {
            value: 'parent',
            label: 'Genitore',
            disabled: !parent,
            title: parent ? `L'elemento genitore <${parent.el.localName}>` : 'Nessun genitore utilizzabile',
          },
        ],
        state.targeting,
        (value) => {
          state.targeting = value;
          engine.clearPreview();
          renderMenu();
          highlightCandidate();
        },
      ),
      h('code', { class: 'selector', title: candidate.selector }, candidate.selector),
      h(
        'div',
        { class: 'meta' },
        countPill(candidate.count),
        candidate.fragile
          ? h('span', { class: 'pill warn', title: "Basato sulla posizione nel DOM: può rompersi se Slack cambia struttura" }, icon('alert', 12), 'Strutturale')
          : null,
      ),
    );

    const scope = h(
      'div',
      { class: 'section' },
      h('span', { class: 'label' }, 'Ambito'),
      segmented(
        [
          {
            value: 'workspace',
            label: team.id ? team.name || team.id : 'Workspace',
            disabled: !team.id,
            title: team.id ? `Solo nel workspace ${team.name || team.id}` : 'Workspace non rilevato dall\'URL',
          },
          { value: 'global', label: 'Tutti i workspace', title: 'Ovunque su app.slack.com' },
        ],
        effectiveScope(),
        (value) => {
          state.scope = value;
          renderMenu();
        },
      ),
    );

    const actions = h(
      'div',
      { class: 'actions', role: 'menu' },
      C.ACTION_ORDER.map(actionRow),
      h(
        'div',
        { class: 'action' },
        h(
          'button',
          { class: 'action-main', type: 'button', role: 'menuitem', onclick: () => openEditor({ action: 'hide' }) },
          h('span', { class: 'ico' }, icon('code', 16)),
          h('span', { class: 'action-text' }, h('strong', null, 'Editor selettore / CSS…'), h('small', null, 'Verifica e ritocca prima di salvare')),
        ),
      ),
    );

    const foot = h(
      'div',
      { class: 'foot' },
      h('span', null, h('kbd', null, 'Esc'), ' esci · tasto destro: annulla selezione'),
    );

    ui.panel.show([head, targeting, scope, actions, foot], { at: state.anchor });
    state.anchor = null; // only the first render is positioned near the click
  }

  function actionRow(action) {
    const meta = C.ACTIONS[action];
    const preview = () => previewAction(action);
    const main = h(
      'button',
      {
        class: 'action-main',
        type: 'button',
        role: 'menuitem',
        onclick: () => createRule(action),
        onpointerenter: preview,
        onpointerleave: clearActionPreview,
        onfocus: preview,
        onblur: clearActionPreview,
      },
      h('span', { class: 'ico' }, icon(meta.icon, 16)),
      h('span', { class: 'action-text' }, h('strong', null, meta.label), h('small', null, meta.hint)),
    );
    return h('div', { class: 'action' }, main, iconButton('sliders', 'Personalizza nell\'editor', () => openEditor({ action })));
  }

  function previewAction(action) {
    const candidate = currentCandidate();
    if (!candidate || state.view !== 'menu') return;
    const options = defaultOptions(action); // measured before the preview changes the layout
    engine.setPreview(engine.buildActionCss(action, candidate.selector, options));
    ui.highlighter.refresh();
  }

  function clearActionPreview() {
    if (state.view !== 'menu') return;
    engine.clearPreview();
    ui.highlighter.refresh();
  }

  async function createRule(action) {
    const candidate = currentCandidate();
    if (!candidate) return;
    engine.clearPreview();
    const rule = {
      selector: candidate.selector,
      action,
      options: defaultOptions(action),
      label: suggestLabel(),
      scope: scopeKey(),
    };
    try {
      const saved = await hooks.addRule(rule);
      deactivate();
      ui.toast(`Regola creata: ${C.ACTIONS[action].label}`, {
        tone: 'success',
        actionLabel: 'Annulla',
        onAction: () => hooks.removeRule(saved.id).catch(reportError),
      });
    } catch (error) {
      reportError(error);
    }
  }

  function reportError(error) {
    const message = String((error && error.message) || error);
    if (/context invalidated/i.test(message)) {
      ui.toast("L'estensione è stata aggiornata: ricarica la pagina di Slack.", { tone: 'error', duration: 8000 });
    } else {
      ui.toast(`Operazione non riuscita: ${message}`, { tone: 'error' });
    }
  }

  /* ------------------------------------------------------------------ editor */

  /**
   * @param {{action?: string, rule?: import('../shared/storage.js').Rule|null, at?: {x:number,y:number}|null}} options
   */
  function openEditor({ action = 'hide', rule = null, at = null } = {}) {
    engine.clearPreview();
    const isCustom = !!rule && rule.action === 'custom';
    const baseAction = rule ? (isCustom ? rule.baseAction || 'hide' : rule.action) : action;
    const sample = rule ? gen.queryAll(rule.selector, 1)[0] || null : targetElement();
    const candidate = currentCandidate();
    state.editor = {
      ruleId: rule ? rule.id : null,
      selector: rule ? rule.selector : candidate.selector,
      action: baseAction,
      options: { ...defaultOptions(baseAction, sample), ...(rule && !isCustom ? rule.options : {}) },
      label: rule ? rule.label : suggestLabel(),
      scope: rule ? rule.scope : scopeKey(),
      css: isCustom ? rule.css : '',
      cssDirty: isCustom,
      live: true,
      valid: false,
      sample,
    };
    if (rule) engine.suspend(rule.id); // preview the edited version, not the stored one on top of it
    state.view = 'editor';
    ui.banner(null);
    ui.tooltip.hide();
    renderEditor(at);
    refreshEditor();
  }

  function renderEditor(at) {
    const ed = state.editor;
    const team = hooks.getTeam();
    const refs = (state.refs = {});

    const head = h(
      'div',
      { class: 'panel-head', 'data-drag-handle': '' },
      h('span', { class: 'tag-chip' }, icon('code', 13)),
      h('span', { class: 'head-title' }, ed.ruleId ? 'Modifica regola' : 'Editor selettore / CSS'),
      iconButton('close', 'Chiudi senza salvare (Esc)', deactivate),
    );

    refs.selector = h('textarea', {
      class: 'wrap',
      rows: 2,
      spellcheck: false,
      'data-enter-submits': '',
      value: ed.selector,
      oninput: (event) => {
        ed.selector = event.target.value.replace(/\s*\n\s*/g, ' ').trim();
        scheduleRefresh();
      },
    });
    refs.selectorStatus = h('div', { class: 'meta' });

    refs.action = h(
      'select',
      {
        onchange: (event) => {
          ed.action = event.target.value;
          ed.options = defaultOptions(ed.action, ed.sample);
          if (ed.action === 'collapse') ed.cssDirty = false;
          renderOptions();
          refreshEditor();
        },
      },
      C.ACTION_ORDER.map((a) => option(a, C.ACTIONS[a].label, ed.action)),
    );
    refs.options = h('div', { class: 'options' });

    refs.label = h('input', {
      type: 'text',
      value: ed.label,
      maxlength: 120,
      placeholder: 'Es. Pulsante Huddle',
      oninput: (event) => {
        ed.label = event.target.value;
      },
    });

    const scopeOptions = [];
    if (team.id) scopeOptions.push(option(team.id, `Questo workspace (${team.name || team.id})`, ed.scope));
    if (ed.scope !== C.GLOBAL_SCOPE && ed.scope !== team.id) scopeOptions.push(option(ed.scope, `Workspace ${ed.scope}`, ed.scope));
    scopeOptions.push(option(C.GLOBAL_SCOPE, 'Tutti i workspace (globale)', ed.scope));
    refs.scope = h('select', { onchange: (event) => { ed.scope = event.target.value; } }, scopeOptions);

    refs.css = h('textarea', {
      rows: 7,
      spellcheck: false,
      value: ed.css,
      oninput: (event) => {
        ed.css = event.target.value;
        ed.cssDirty = true;
        updateCssState();
        scheduleRefresh();
      },
    });
    refs.cssState = h('div', { class: 'meta' });

    refs.live = h('input', {
      type: 'checkbox',
      checked: ed.live,
      onchange: (event) => {
        ed.live = event.target.checked;
        applyEditorPreview();
      },
    });

    const body = h(
      'div',
      { class: 'section' },
      field('Selettore CSS', refs.selector, refs.selectorStatus),
      field('Azione', refs.action),
      refs.options,
      field('Nome della regola', refs.label),
      field('Ambito', refs.scope),
      field('Regola CSS', refs.css, refs.cssState),
    );

    const foot = h(
      'div',
      { class: 'foot sticky' },
      h('label', { class: 'check' }, refs.live, 'Anteprima live'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', type: 'button', onclick: cancelEditor }, state.baseEl ? 'Indietro' : 'Annulla'),
      h('button', { class: 'btn primary', type: 'button', onclick: saveEditor }, icon('check', 14), ed.ruleId ? 'Aggiorna' : 'Salva regola'),
    );

    ui.panel.show([head, body, foot], { at, wide: true });
    renderOptions();
    updateCssState();
    refs.selector.focus();
  }

  function renderOptions() {
    const ed = state.editor;
    const box = state.refs.options;
    const o = ed.options;
    const changed = () => scheduleRefresh();
    box.replaceChildren();
    switch (ed.action) {
      case 'hover': {
        const ancestor = h('input', {
          type: 'text',
          class: 'mono',
          value: o.hoverAncestor || '',
          placeholder: '[data-qa="message_container"]',
          hidden: o.hoverTarget !== 'ancestor',
          oninput: (event) => {
            o.hoverAncestor = event.target.value.trim();
            changed();
          },
        });
        const target = h(
          'select',
          {
            onchange: (event) => {
              o.hoverTarget = event.target.value;
              ancestor.hidden = o.hoverTarget !== 'ancestor';
              changed();
            },
          },
          option('parent', 'Il genitore diretto', o.hoverTarget),
          option('container', 'Il contenitore (messaggio, voce di lista)', o.hoverTarget),
          option('ancestor', 'Un antenato personalizzato…', o.hoverTarget),
        );
        box.append(field('Rivela quando il cursore è su', target, ancestor));
        break;
      }
      case 'fade': {
        const value = h('span', { class: 'range-val' }, `${Math.round(o.opacity * 100)}%`);
        const range = h('input', {
          type: 'range',
          min: 0,
          max: 1,
          step: 0.05,
          value: String(o.opacity),
          oninput: (event) => {
            o.opacity = Number(event.target.value);
            value.textContent = `${Math.round(o.opacity * 100)}%`;
            changed();
          },
        });
        const restore = h('input', {
          type: 'checkbox',
          checked: o.restoreOnHover,
          onchange: (event) => {
            o.restoreOnHover = event.target.checked;
            changed();
          },
        });
        box.append(field('Opacità', h('div', { class: 'range' }, range, value)), h('div', { class: 'field' }, h('label', { class: 'check' }, restore, 'Ripristina al 100% in hover')));
        break;
      }
      case 'compact': {
        const mode = h(
          'select',
          {
            onchange: (event) => {
              o.compactMode = event.target.value;
              changed();
            },
          },
          option('half', 'Dimezza padding, margini e gap', o.compactMode),
          option('zero', 'Azzera padding e margini', o.compactMode),
        );
        const measured = o.compactValues
          ? `Valori dimezzati: ${Object.entries(o.compactValues).map(([k, v]) => `${k} ${v}`).join(' · ')}`
          : 'Nessun elemento campione: la spaziatura verrà azzerata.';
        box.append(field('Spaziatura', mode, h('span', { class: 'hint' }, measured)));
        break;
      }
      case 'collapse': {
        const collapsed = h('input', {
          type: 'checkbox',
          checked: o.collapsed,
          onchange: (event) => {
            o.collapsed = event.target.checked;
            changed();
          },
        });
        box.append(
          h(
            'div',
            { class: 'field' },
            h('label', { class: 'check' }, collapsed, 'Inizia chiuso'),
            h('span', { class: 'hint' }, 'Prima di ogni elemento viene inserito un pulsante ▸/▾ che apre e chiude il blocco.'),
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  function updateCssState() {
    const ed = state.editor;
    const refs = state.refs;
    refs.css.readOnly = ed.action === 'collapse';
    let content;
    if (ed.action === 'collapse') {
      content = h('span', { class: 'hint' }, 'Gestito dal pulsante di toggle: il CSS non è modificabile.');
    } else if (ed.cssDirty) {
      content = [
        h('span', { class: 'pill warn' }, 'Modificato a mano'),
        h('button', { class: 'link', type: 'button', onclick: resetCss }, 'Rigenera dal selettore'),
      ];
    } else {
      content = h('span', { class: 'hint' }, 'Generato automaticamente. Modificalo per salvare una regola CSS personalizzata.');
    }
    refs.cssState.replaceChildren(...[].concat(content));
  }

  function resetCss() {
    state.editor.cssDirty = false;
    refreshEditor();
  }

  function scheduleRefresh() {
    clearTimeout(editorTimer);
    editorTimer = setTimeout(refreshEditor, EDITOR_DEBOUNCE_MS);
  }

  function refreshEditor() {
    clearTimeout(editorTimer);
    editorTimer = 0;
    const ed = state.editor;
    if (!ed || state.view !== 'editor') return;
    const refs = state.refs;
    const result = gen.validate(ed.selector);
    ed.valid = result.ok;
    refs.selectorStatus.replaceChildren(result.ok ? countPill(result.count) : countPill(-1));
    if (!ed.cssDirty) {
      ed.css = result.ok ? engine.buildActionCss(ed.action, ed.selector, ed.options) : '';
      if (refs.css.value !== ed.css) refs.css.value = ed.css;
    }
    updateCssState();
    ui.highlighter.setPrimary(null);
    ui.highlighter.setMatches(result.ok ? gen.queryAll(ed.selector, MAX_HIGHLIGHTED_MATCHES) : []);
    applyEditorPreview();
  }

  function editorCss() {
    const ed = state.editor;
    return ed.cssDirty && ed.action !== 'collapse' ? ed.css : engine.buildActionCss(ed.action, ed.selector, ed.options);
  }

  function applyEditorPreview() {
    const ed = state.editor;
    if (!ed || !ed.live || !ed.valid) engine.clearPreview();
    else engine.setPreview(editorCss());
    ui.highlighter.refresh();
  }

  function cancelEditor() {
    const ed = state.editor;
    engine.clearPreview();
    if (ed && ed.ruleId) engine.suspend(null);
    if (!state.baseEl) {
      deactivate();
      return;
    }
    state.editor = null;
    state.refs = null;
    state.view = 'menu';
    renderMenu();
    highlightCandidate();
  }

  async function saveEditor() {
    const ed = state.editor;
    if (!ed || ed.saving) return;
    const result = gen.validate(ed.selector);
    if (!result.ok) {
      ui.toast(result.error || 'Selettore non valido.', { tone: 'error' });
      state.refs.selector.focus();
      return;
    }
    let rule;
    if (ed.cssDirty && ed.action !== 'collapse') {
      if (!engine.sanitizeCss(ed.css)) {
        ui.toast('Il CSS non contiene regole valide.', { tone: 'error' });
        state.refs.css.focus();
        return;
      }
      rule = { selector: ed.selector, action: 'custom', baseAction: ed.action, css: ed.css, options: {} };
    } else {
      rule = { selector: ed.selector, action: ed.action, options: ed.options, css: '', baseAction: null };
    }
    rule.label = ed.label.trim();
    rule.scope = ed.scope;
    ed.saving = true;
    try {
      if (ed.ruleId) {
        await hooks.updateRule(ed.ruleId, rule);
        deactivate();
        ui.toast('Regola aggiornata.', { tone: 'success' });
      } else {
        const saved = await hooks.addRule(rule);
        deactivate();
        ui.toast('Regola salvata.', {
          tone: 'success',
          actionLabel: 'Annulla',
          onAction: () => hooks.removeRule(saved.id).catch(reportError),
        });
      }
    } catch (error) {
      ed.saving = false;
      reportError(error);
    }
  }

  /* ------------------------------------------------------------------ entry points for the popup */

  /** Opens the editor on an existing rule. @returns {boolean} */
  function editRule(rule) {
    if (!activate()) return false;
    engine.clearPreview();
    Object.assign(state, { baseEl: null, trail: [], candidates: null });
    const panelWidth = Math.min(440, innerWidth - 16);
    openEditor({ rule, at: { x: Math.max(8, innerWidth - panelWidth - 40), y: 60 } });
    return true;
  }

  /** Outlines the elements of a rule for a moment, showing them even if the rule hides them. */
  function flashRule(rule, durationMs = 2200) {
    engine.suspend(rule.id, durationMs);
    const elements = gen.queryAll(rule.selector, 200);
    ui.flash(elements, durationMs);
    return elements.length;
  }

  SUT.inspector = Object.freeze({ init, activate, deactivate, toggle, isActive, editRule, flashRule });
})(globalThis);
