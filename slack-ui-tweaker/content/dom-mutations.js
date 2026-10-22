/**
 * Slack UI Tweaker — DOM mutations for interactive rules ("Collassabile con toggle").
 *
 * CSS alone can hide a block, but the ▸/▾ button that opens it again has to live in Slack's DOM,
 * right before each matching element. Slack re-creates those nodes constantly (SPA navigation,
 * virtualized lists), so a MutationObserver re-attaches the buttons.
 *
 * Performance guards (Slack's virtual_list adds/removes rows on every scroll frame):
 * - the observer exists only while at least one collapse rule is active;
 * - it watches childList only (no attributes, no character data);
 * - records are batched into one requestAnimationFrame pass that only inspects the added subtrees
 *   (a full document scan only for big batches), before the next paint, so buttons never flicker;
 * - injected toggles are tracked in a Set: orphan cleanup never queries the whole document.
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});
  const C = SUT.constants;
  const engine = SUT.styleEngine;

  const TOGGLE = 'toggle';
  const FULL_SCAN_THRESHOLD = 150;
  const STOPPED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress'];

  const TOGGLE_CSS = `
    :host { display: block; }
    button {
      all: initial;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      margin: 2px 0;
      padding: 1px 6px 1px 4px;
      border-radius: 4px;
      font: 500 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: inherit;
      opacity: 0.6;
      cursor: pointer;
    }
    button:hover, button:focus-visible { opacity: 1; background: rgba(127, 127, 127, 0.18); }
    button:focus-visible { outline: 2px solid #1d9bd1; outline-offset: 1px; }
    .arrow { display: inline-block; width: 10px; text-align: center; transition: transform 0.15s ease; }
    :host([data-collapsed="false"]) .arrow { transform: rotate(90deg); }
    .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .label:empty { display: none; }
    @media (prefers-reduced-motion: reduce) { .arrow { transition: none; } }
  `;

  /** @type {import('../shared/storage.js').Rule[]} */
  let rules = [];
  let observer = null;
  let frame = 0;
  let fullScan = false;
  let checkOrphans = false;
  let waitingForBody = false;
  let onToggle = () => {};
  const pendingRoots = new Set();
  /** @type {Set<HTMLElement>} every toggle host we inserted */
  const toggles = new Set();

  /** @param {{onToggle: (ruleId: string) => void}} options */
  function init(options) {
    if (options && typeof options.onToggle === 'function') onToggle = options.onToggle;
  }

  /** Receives the rules active on the current workspace and keeps only the collapse ones. */
  function setRules(activeRules) {
    rules = activeRules.filter((rule) => rule.enabled && rule.action === 'collapse' && engine.isValidSelector(rule.selector));
    if (!rules.length) {
      disconnect();
      removeAllToggles();
      return;
    }
    connect();
    fullScan = true;
    checkOrphans = true;
    schedule();
  }

  /* ------------------------------------------------------------------ observer */

  function connect() {
    if (observer) return;
    if (!document.body) {
      if (!waitingForBody) {
        waitingForBody = true;
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            waitingForBody = false;
            if (!rules.length) return;
            connect();
            fullScan = true;
            schedule();
          },
          { once: true },
        );
      }
      return;
    }
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function disconnect() {
    if (observer) observer.disconnect();
    observer = null;
    pendingRoots.clear();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function onMutations(records) {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute(C.UI_ATTR)) pendingRoots.add(node);
      }
      if (record.removedNodes.length) checkOrphans = true;
    }
    if (pendingRoots.size || checkOrphans) schedule();
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(flush);
  }

  function flush() {
    frame = 0;
    const full = fullScan || pendingRoots.size > FULL_SCAN_THRESHOLD;
    const scopes = full ? [document] : Array.from(pendingRoots);
    pendingRoots.clear();
    fullScan = false;
    if (checkOrphans || full) {
      checkOrphans = false;
      cleanup();
    }
    for (const rule of rules) {
      for (const scope of scopes) {
        if (scope !== document) {
          if (!scope.isConnected) continue;
          if (matchesSafe(scope, rule.selector)) ensureToggle(scope, rule);
        }
        for (const el of queryAllSafe(scope, rule.selector)) ensureToggle(el, rule);
      }
    }
  }

  /* ------------------------------------------------------------------ toggles */

  function ensureToggle(el, rule) {
    if (!el.parentNode || el === document.body || el === document.documentElement || el.hasAttribute(C.UI_ATTR)) return;
    // Toggles sit right before their target (several rules may stack their own).
    for (let prev = el.previousElementSibling; prev && prev.getAttribute(C.UI_ATTR) === TOGGLE; prev = prev.previousElementSibling) {
      if (prev.getAttribute(C.RULE_ATTR) === rule.id) {
        paint(prev, rule);
        return;
      }
    }
    const host = createToggle(rule);
    el.parentNode.insertBefore(host, el);
    toggles.add(host);
  }

  function createToggle(rule) {
    const host = document.createElement('span');
    host.setAttribute(C.UI_ATTR, TOGGLE);
    host.setAttribute(C.RULE_ATTR, rule.id);
    // Layout reset applied through CSSOM (allowed by Slack's CSP) so Slack's styles cannot bend it.
    host.style.cssText =
      'display:block!important;margin:0!important;padding:0!important;border:0!important;background:none!important;' +
      'position:static!important;opacity:1!important;visibility:visible!important;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = TOGGLE_CSS;
    const button = document.createElement('button');
    button.type = 'button';
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▸';
    const label = document.createElement('span');
    label.className = 'label';
    button.append(arrow, label);
    // Keep the click away from Slack: the toggle often sits inside clickable rows (sidebar items).
    for (const type of STOPPED_EVENTS) button.addEventListener(type, stopPropagation);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      onToggle(host.getAttribute(C.RULE_ATTR));
    });
    shadow.append(style, button);
    paint(host, rule);
    return host;
  }

  function paint(host, rule) {
    const collapsed = rule.options?.collapsed !== false;
    const name = rule.label || 'blocco';
    const signature = `${collapsed}|${name}`;
    if (host.dataset.sutSignature === signature) return; // nothing changed: avoid DOM churn
    host.dataset.sutSignature = signature;
    host.setAttribute('data-collapsed', String(collapsed));
    const button = host.shadowRoot.querySelector('button');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = `${collapsed ? 'Mostra' : 'Nascondi'} "${name}" · Slack UI Tweaker`;
    // Closed: arrow + name, so it is clear what is hidden. Open: just the arrow.
    button.querySelector('.label').textContent = collapsed ? name : '';
  }

  function nextTarget(host) {
    let node = host.nextElementSibling;
    while (node && node.getAttribute(C.UI_ATTR) === TOGGLE) node = node.nextElementSibling;
    return node;
  }

  /** Removes toggles whose target disappeared or no longer matches its rule. */
  function cleanup() {
    for (const host of toggles) {
      if (!host.isConnected) {
        toggles.delete(host);
        continue;
      }
      const rule = rules.find((r) => r.id === host.getAttribute(C.RULE_ATTR));
      const target = nextTarget(host);
      if (!rule || !target || !matchesSafe(target, rule.selector)) {
        host.remove();
        toggles.delete(host);
      }
    }
  }

  function removeAllToggles() {
    for (const host of toggles) host.remove();
    toggles.clear();
  }

  /* ------------------------------------------------------------------ helpers */

  function stopPropagation(event) {
    event.stopPropagation();
  }

  function matchesSafe(el, selector) {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }

  function queryAllSafe(scope, selector) {
    try {
      return scope.querySelectorAll(selector);
    } catch {
      return [];
    }
  }

  SUT.domMutations = Object.freeze({ init, setRules });
})(globalThis);
