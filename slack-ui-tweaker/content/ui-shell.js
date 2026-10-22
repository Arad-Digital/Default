/**
 * Slack UI Tweaker — in-page UI shell.
 *
 * Owns the single host element <div id="slack-ui-tweaker-root"> appended to <html> (outside the
 * React tree) and its Shadow DOM, which isolates our styles from Slack's CSS and vice versa.
 * It provides the building blocks used by the inspector: highlight boxes, tooltip, floating panel,
 * banner, toasts and the floating launcher button. It has no knowledge of rules.
 *
 * Highlights are absolutely positioned overlay boxes (pointer-events: none): Slack's box model is
 * never touched while inspecting.
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});
  const C = SUT.constants;
  const { h, icon } = SUT.dom;

  /** Pointer events born in our UI must not bubble into Slack's listeners. */
  const STOPPED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];
  const STOPPED_PASSIVE_EVENTS = ['wheel', 'touchstart', 'touchmove', 'touchend'];
  const MAX_BOXES = 80;
  const MAX_TRACKED_MATCHES = 300;
  const EDGE = 8;

  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

  const STYLES = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    svg { display: block; flex: none; }

    .layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }

    /* ---------- highlight boxes ---------- */
    .box { position: fixed; top: 0; left: 0; border-radius: 3px; pointer-events: none; }
    .box.primary { outline: 2px solid #1d9bd1; outline-offset: -1px; background: rgba(29, 155, 209, 0.12); }
    .box.selected { outline: 2px solid #2bac76; outline-offset: -1px; background: rgba(43, 172, 118, 0.14); }
    .box.match { outline: 2px dashed #ecb22e; outline-offset: -1px; background: rgba(236, 178, 46, 0.1); }
    .box.flash { outline: 2px solid #e01e5a; outline-offset: -1px; background: rgba(224, 30, 90, 0.12); animation: pulse 0.7s ease-in-out 3; }
    @keyframes pulse { 50% { background: rgba(224, 30, 90, 0.3); } }

    /* ---------- tooltip ---------- */
    .tip {
      position: fixed; top: 0; left: 0; max-width: min(560px, calc(100vw - 16px));
      padding: 4px 8px; border-radius: 6px; background: #121416; color: #f8f8f8;
      font: 500 11.5px/1.4 ${MONO}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35); pointer-events: none;
    }
    .tip .tag { color: #7fd1f5; font-weight: 700; }
    .tip .hint { color: #ffd479; margin-left: 6px; }
    .tip .dim { color: #9a9ca0; margin-left: 8px; }

    /* ---------- banner ---------- */
    .banner {
      position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
      background: rgba(18, 20, 22, 0.92); color: #f2f2f2; font: 500 12.5px/1.3 ${FONT};
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); pointer-events: none; white-space: nowrap;
    }
    .banner svg { color: #36c5f0; }

    /* ---------- panel ---------- */
    .panel {
      position: fixed; top: 0; left: 0; pointer-events: auto; color-scheme: dark;
      width: 340px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto;
      overscroll-behavior: contain; background: #1b1d21; color: #e9e9ea;
      border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
      font: 13px/1.45 ${FONT}; cursor: default; animation: pop 0.12s ease-out;
    }
    .panel.wide { width: 440px; }
    @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
    .panel-head {
      position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px;
      padding: 9px 8px 8px 12px; background: #1b1d21; border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      cursor: move; user-select: none;
    }
    .tag-chip {
      display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 5px;
      background: rgba(29, 155, 209, 0.18); color: #7fd1f5; font: 600 11px/1.2 ${MONO}; white-space: nowrap;
    }
    .head-title { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .head-title.mono { font: 500 11.5px/1.3 ${MONO}; color: #ffd479; }
    .section { padding: 10px 12px; }
    .section + .section { border-top: 1px solid rgba(255, 255, 255, 0.07); }
    .label { display: block; margin-bottom: 6px; color: #9a9ca0; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .selector {
      display: block; margin-top: 8px; padding: 6px 8px; max-height: 70px; overflow: auto;
      background: #121416; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px;
      color: #ffd479; font: 11.5px/1.45 ${MONO}; word-break: break-all; user-select: text; cursor: text;
    }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; color: #b9babd; }
    .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.08); font-size: 11.5px; white-space: nowrap; }
    .pill.ok { background: rgba(43, 172, 118, 0.18); color: #6fdcaa; }
    .pill.warn { background: rgba(236, 178, 46, 0.18); color: #ffd479; }
    .pill.err { background: rgba(224, 30, 90, 0.2); color: #ff8fb1; }
    .hint { color: #8b8d91; font-size: 11.5px; }

    .segmented { display: flex; gap: 3px; padding: 3px; border-radius: 8px; background: #121416; }
    .segmented button {
      all: unset; flex: 1 1 0; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      padding: 6px 6px; border-radius: 6px; color: #b9babd; font: 500 12px/1.2 ${FONT};
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
    }
    .segmented button:hover { color: #fff; }
    .segmented button[aria-pressed="true"] { background: #2f3238; color: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
    .segmented button:disabled { opacity: 0.4; cursor: default; }
    .segmented .n { padding: 0 5px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); font-size: 10.5px; font-variant-numeric: tabular-nums; }

    .actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; padding: 6px; }
    .action { display: flex; align-items: center; gap: 2px; padding-right: 4px; border-radius: 8px; }
    .action:hover, .action:focus-within { background: rgba(255, 255, 255, 0.06); }
    .action-main { all: unset; flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
    .action-main .ico { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 7px; background: rgba(255, 255, 255, 0.07); color: #e9e9ea; }
    .action-main:hover .ico { background: #1d9bd1; color: #fff; }
    .action-text { display: flex; flex-direction: column; min-width: 0; }
    .action-text strong { font-size: 13px; font-weight: 600; }
    .action-text small { overflow: hidden; color: #9a9ca0; font-size: 11.5px; white-space: nowrap; text-overflow: ellipsis; }

    .icon-btn { all: unset; display: inline-grid; place-items: center; width: 26px; height: 26px; flex: none; border-radius: 6px; color: #b9babd; cursor: pointer; }
    .icon-btn:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .icon-btn:disabled { opacity: 0.3; background: none; cursor: default; }

    .foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px 10px; border-top: 1px solid rgba(255, 255, 255, 0.07); color: #8b8d91; font-size: 11.5px; }
    .foot.sticky { position: sticky; bottom: 0; background: #1b1d21; }
    .spacer { flex: 1; }
    kbd { padding: 1px 5px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 4px; background: #2c2f35; color: #ddd; font: 600 10.5px/1.4 ${MONO}; }

    /* ---------- form ---------- */
    .field { display: grid; gap: 5px; margin-bottom: 11px; }
    .field > span { color: #b9babd; font-size: 11.5px; font-weight: 600; }
    input[type="text"], textarea, select {
      width: 100%; margin: 0; padding: 7px 9px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; outline: none;
      background: #121416; color: #f2f2f2; font: 12.5px/1.45 ${FONT};
    }
    textarea, .mono { font: 12px/1.5 ${MONO}; }
    textarea { min-height: 54px; resize: vertical; white-space: pre; overflow: auto; tab-size: 2; }
    textarea.wrap { white-space: pre-wrap; word-break: break-all; resize: none; }
    textarea[readonly] { color: #9a9ca0; }
    input:focus, textarea:focus, select:focus { border-color: #1d9bd1; box-shadow: 0 0 0 3px rgba(29, 155, 209, 0.25); }
    .check { display: inline-flex; align-items: center; gap: 6px; color: #d1d2d3; font-size: 12px; cursor: pointer; user-select: none; }
    input[type="checkbox"], input[type="range"] { accent-color: #1d9bd1; margin: 0; }
    .range { display: flex; align-items: center; gap: 10px; }
    .range input { flex: 1; }
    .range-val { width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
    .options:empty { display: none; }

    .btn { all: unset; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 7px; font: 600 12.5px/1.2 ${FONT}; cursor: pointer; white-space: nowrap; }
    .btn.primary { background: #2bac76; color: #fff; }
    .btn.primary:hover { background: #239a69; }
    .btn.ghost { background: rgba(255, 255, 255, 0.07); color: #e1e2e3; }
    .btn.ghost:hover { background: rgba(255, 255, 255, 0.12); }
    .link { all: unset; color: #7fd1f5; font-size: 11.5px; cursor: pointer; text-decoration: underline; }

    button:focus-visible, .btn:focus-visible, .icon-btn:focus-visible, .action-main:focus-visible, .segmented button:focus-visible {
      outline: 2px solid #1d9bd1; outline-offset: 1px;
    }

    /* ---------- toasts ---------- */
    .toasts { position: fixed; bottom: 18px; left: 50%; display: flex; flex-direction: column; align-items: center; gap: 8px; transform: translateX(-50%); pointer-events: none; }
    .toast {
      display: flex; align-items: center; gap: 10px; max-width: min(520px, calc(100vw - 32px)); padding: 9px 10px 9px 14px;
      border-radius: 10px; background: #1b1d21; color: #f2f2f2; border-left: 3px solid #1d9bd1;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4); font: 500 13px/1.4 ${FONT}; pointer-events: auto; animation: pop 0.15s ease-out;
    }
    .toast.success { border-left-color: #2bac76; }
    .toast.warn { border-left-color: #ecb22e; }
    .toast.error { border-left-color: #e01e5a; }
    .toast.leaving { opacity: 0; transition: opacity 0.18s ease; }
    .toast-action { all: unset; color: #7fd1f5; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .toast-action:hover { text-decoration: underline; }

    /* ---------- floating launcher ---------- */
    .fab {
      all: unset; position: fixed; right: 10px; top: 50%; transform: translateY(-50%); z-index: 1;
      display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
      background: rgba(27, 29, 33, 0.85); color: #e9e9ea; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      opacity: 0.45; cursor: pointer; pointer-events: auto; touch-action: none; transition: opacity 0.15s ease, background 0.15s ease;
    }
    .fab:hover, .fab:focus-visible { opacity: 1; }
    .fab:focus-visible { outline: 2px solid #1d9bd1; outline-offset: 2px; }
    .fab.active { opacity: 1; background: #1d9bd1; color: #fff; }
    .fab.dragging { cursor: grabbing; opacity: 1; }

    @media (prefers-reduced-motion: reduce) {
      .panel, .toast { animation: none; }
      .box.flash { animation: none; }
    }
  `;

  let host = null;
  let shadow = null;
  const layer = { boxes: null, tip: null, panel: null, banner: null, toasts: null, fab: null };

  function stopPropagation(event) {
    event.stopPropagation();
  }

  /** Creates the host + shadow root on first use. Safe to call repeatedly. */
  function mount() {
    if (host) {
      if (!host.isConnected) document.documentElement.appendChild(host);
      return;
    }
    host = document.createElement('div');
    host.id = C.UI_HOST_ID;
    host.setAttribute(C.UI_ATTR, 'root');
    host.style.cssText =
      'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;' +
      'height:0!important;z-index:2147483647!important;display:block!important;';
    shadow = host.attachShadow({ mode: 'open' });
    layer.boxes = h('div', { class: 'layer' });
    layer.tip = h('div', { class: 'tip', hidden: true });
    layer.panel = h('div', { class: 'layer' });
    layer.banner = h('div', { class: 'banner', hidden: true, role: 'status' });
    layer.toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    shadow.append(h('style', { text: STYLES }), layer.boxes, layer.tip, layer.panel, layer.banner, layer.toasts);
    for (const type of STOPPED_EVENTS) shadow.addEventListener(type, stopPropagation);
    for (const type of STOPPED_PASSIVE_EVENTS) shadow.addEventListener(type, stopPropagation, { passive: true });
    document.documentElement.appendChild(host);
  }

  /** True for events whose (retargeted) target is our UI host. */
  function isFromUI(event) {
    return host !== null && event.target === host;
  }

  /** Focused element inside our shadow root, if any. */
  function activeElement() {
    return shadow ? shadow.activeElement : null;
  }

  function isOnScreen(rect) {
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }

  function placeBox(node, rect) {
    node.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    node.style.width = `${Math.round(rect.width)}px`;
    node.style.height = `${Math.round(rect.height)}px`;
  }

  /* ------------------------------------------------------------------ highlighter */

  const highlighter = (() => {
    let primary = null;
    let primaryKind = 'primary';
    let matches = [];
    const pool = [];

    function box(index) {
      if (!pool[index]) {
        pool[index] = h('div', { class: 'box' });
        layer.boxes.append(pool[index]);
      }
      return pool[index];
    }

    /** Re-reads rects: call on scroll/resize (the inspector throttles it with rAF). */
    function refresh() {
      if (!host) return;
      let used = 0;
      if (primary && primary.isConnected) {
        const rect = primary.getBoundingClientRect();
        if (isOnScreen(rect)) {
          const node = box(used++);
          node.className = `box ${primaryKind}`;
          node.hidden = false;
          placeBox(node, rect);
        }
      }
      for (const el of matches) {
        if (used >= MAX_BOXES) break;
        if (el === primary || !el.isConnected) continue;
        const rect = el.getBoundingClientRect();
        if (!isOnScreen(rect)) continue;
        const node = box(used++);
        node.className = 'box match';
        node.hidden = false;
        placeBox(node, rect);
      }
      for (let i = used; i < pool.length; i++) pool[i].hidden = true;
    }

    return {
      setPrimary(el, kind = 'primary') {
        mount();
        primary = el || null;
        primaryKind = kind;
        refresh();
      },
      setMatches(elements) {
        mount();
        matches = elements ? Array.from(elements).slice(0, MAX_TRACKED_MATCHES) : [];
        refresh();
      },
      refresh,
      clear() {
        primary = null;
        matches = [];
        refresh();
      },
    };
  })();

  /** Briefly outlines elements (used by "Evidenzia" in the popup). */
  function flash(elements, durationMs = 2200) {
    mount();
    const nodes = [];
    for (const el of elements) {
      if (nodes.length >= MAX_BOXES) break;
      const rect = el.getBoundingClientRect();
      if (!isOnScreen(rect)) continue;
      const node = h('div', { class: 'box flash' });
      placeBox(node, rect);
      nodes.push(node);
    }
    layer.boxes.append(...nodes);
    setTimeout(() => nodes.forEach((node) => node.remove()), durationMs);
    return nodes.length;
  }

  /* ------------------------------------------------------------------ tooltip */

  const tooltip = {
    /** @param {Element} el @param {{tag: string, hint: string}} info */
    show(el, info) {
      mount();
      const rect = el.getBoundingClientRect();
      const tip = layer.tip;
      tip.replaceChildren(
        h('span', { class: 'tag' }, info.tag),
        info.hint ? h('span', { class: 'hint' }, info.hint) : null,
        h('span', { class: 'dim' }, `${Math.round(rect.width)}×${Math.round(rect.height)}`),
      );
      tip.hidden = false;
      const tipRect = tip.getBoundingClientRect();
      let top = rect.top - tipRect.height - 6;
      if (top < 4) top = Math.min(rect.bottom + 6, innerHeight - tipRect.height - 4);
      const left = Math.max(4, Math.min(rect.left, innerWidth - tipRect.width - 4));
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, top))}px)`;
    },
    hide() {
      if (layer.tip) layer.tip.hidden = true;
    },
  };

  /* ------------------------------------------------------------------ banner */

  function banner(text) {
    if (!text) {
      if (layer.banner) layer.banner.hidden = true;
      return;
    }
    mount();
    layer.banner.replaceChildren(icon('target', 15), h('span', null, text), h('kbd', null, 'Esc'));
    layer.banner.hidden = false;
  }

  /* ------------------------------------------------------------------ panel */

  const panel = (() => {
    let node = null;

    function setPosition(left, top) {
      const rect = node.getBoundingClientRect();
      const maxLeft = Math.max(EDGE, innerWidth - rect.width - EDGE);
      const maxTop = Math.max(EDGE, innerHeight - rect.height - EDGE);
      node.style.left = `${Math.round(Math.min(Math.max(EDGE, left), maxLeft))}px`;
      node.style.top = `${Math.round(Math.min(Math.max(EDGE, top), maxTop))}px`;
    }

    /** Next to the pointer, flipped to the left/top when there is no room. */
    function placeNear(x, y) {
      const rect = node.getBoundingClientRect();
      let left = x + 16;
      if (left + rect.width > innerWidth - EDGE) left = x - rect.width - 16;
      let top = y + 12;
      if (top + rect.height > innerHeight - EDGE) top = innerHeight - rect.height - EDGE;
      setPosition(left, top);
    }

    function clamp() {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setPosition(rect.left, rect.top);
    }

    /** Drag the panel by any element marked with data-drag-handle (except its controls). */
    function startDrag(event) {
      if (event.button !== 0) return;
      const handle = event.target.closest('[data-drag-handle]');
      if (!handle || event.target.closest('button, input, select, textarea, a, label')) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const dx = event.clientX - rect.left;
      const dy = event.clientY - rect.top;
      handle.setPointerCapture(event.pointerId);
      const move = (e) => setPosition(e.clientX - dx, e.clientY - dy);
      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    }

    return {
      /**
       * @param {Array<Node|null>} children
       * @param {{at?: {x: number, y: number}|null, wide?: boolean}} [options]
       */
      show(children, { at = null, wide = false } = {}) {
        mount();
        const created = !node;
        if (created) {
          node = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Slack UI Tweaker' });
          node.addEventListener('pointerdown', startDrag);
          layer.panel.append(node);
        }
        node.classList.toggle('wide', wide);
        node.replaceChildren(...children.filter(Boolean));
        if (at) placeNear(at.x, at.y);
        else if (created) setPosition(innerWidth - node.getBoundingClientRect().width - 24, 72);
        else clamp();
      },
      clamp,
      close() {
        if (node) node.remove();
        node = null;
      },
      get element() {
        return node;
      },
    };
  })();

  /* ------------------------------------------------------------------ toasts */

  /**
   * @param {string} message
   * @param {{tone?: 'info'|'success'|'warn'|'error', actionLabel?: string, onAction?: () => void, duration?: number}} [options]
   * @returns {() => void} dismiss
   */
  function toast(message, { tone = 'info', actionLabel = null, onAction = null, duration = 4500 } = {}) {
    mount();
    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 180);
    };
    const node = h(
      'div',
      { class: `toast ${tone}` },
      h('span', null, message),
      actionLabel
        ? h('button', { class: 'toast-action', type: 'button', onclick: () => { dismiss(); if (onAction) onAction(); } }, actionLabel)
        : null,
      h('button', { class: 'icon-btn', type: 'button', title: 'Chiudi', 'aria-label': 'Chiudi', onclick: dismiss }, icon('close', 14)),
    );
    layer.toasts.append(node);
    while (layer.toasts.children.length > 3) layer.toasts.firstElementChild.remove();
    timer = setTimeout(dismiss, duration);
    return dismiss;
  }

  /* ------------------------------------------------------------------ floating launcher */

  let fabHandlers = { onClick: null, onMove: null };

  function createFab() {
    const fab = h(
      'button',
      { class: 'fab', type: 'button', title: 'Slack UI Tweaker — Ispettore (Alt+S) · trascina per spostare', 'aria-label': 'Avvia ispettore Slack UI Tweaker' },
      icon('target', 16),
    );
    let suppressClick = false;
    fab.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const startY = event.clientY;
      let moved = false;
      fab.setPointerCapture(event.pointerId);
      const move = (e) => {
        if (!moved && Math.abs(e.clientY - startY) < 5) return;
        moved = true;
        fab.classList.add('dragging');
        fab.style.top = `${Math.min(95, Math.max(5, (e.clientY / innerHeight) * 100)).toFixed(1)}%`;
      };
      const up = () => {
        fab.removeEventListener('pointermove', move);
        fab.removeEventListener('pointerup', up);
        fab.removeEventListener('pointercancel', up);
        fab.classList.remove('dragging');
        if (moved) {
          suppressClick = true;
          if (fabHandlers.onMove) fabHandlers.onMove(parseFloat(fab.style.top));
        }
      };
      fab.addEventListener('pointermove', move);
      fab.addEventListener('pointerup', up);
      fab.addEventListener('pointercancel', up);
    });
    fab.addEventListener('click', () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (fabHandlers.onClick) fabHandlers.onClick();
    });
    return fab;
  }

  /**
   * @param {{visible: boolean, top?: number, active?: boolean, onClick?: () => void, onMove?: (top: number) => void}} options
   */
  function setFab({ visible, top = 50, active = false, onClick = null, onMove = null }) {
    fabHandlers = { onClick, onMove };
    if (!visible) {
      if (layer.fab) layer.fab.remove();
      layer.fab = null;
      return;
    }
    mount();
    if (!layer.fab) {
      layer.fab = createFab();
      shadow.append(layer.fab);
    }
    if (!layer.fab.classList.contains('dragging')) layer.fab.style.top = `${top}%`;
    layer.fab.classList.toggle('active', !!active);
  }

  function setFabActive(active) {
    if (layer.fab) layer.fab.classList.toggle('active', !!active);
  }

  SUT.ui = Object.freeze({
    mount,
    isFromUI,
    activeElement,
    highlighter,
    flash,
    tooltip,
    banner,
    panel,
    toast,
    setFab,
    setFabActive,
  });
})(globalThis);
