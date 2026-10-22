/**
 * Slack UI Tweaker — Style Engine.
 *
 * Turns rules into CSS and keeps it in a single <style id="slack-ui-tweaker-styles"> in <head>.
 * The stylesheet is static between rule changes: Slack's SPA navigation (channel switch, threads,
 * search) and its virtualized lists re-render DOM nodes that are matched by the same CSS instantly,
 * so there is no flicker and no per-node JavaScript work.
 *
 * Every rule's CSS is parsed with a constructable stylesheet and re-serialized before injection:
 * a malformed rule cannot swallow the next ones, and remote resources (url(https://…)) are dropped,
 * so an imported backup cannot make Slack load or leak anything.
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});
  const C = SUT.constants;

  /** Never apply rules to the nodes we inject (UI host, collapse toggles). */
  const NOT_UI = `:not([${C.UI_ATTR}])`;
  const TRANSITION = 'opacity 0.15s ease-in-out';
  const RESOURCE_FN = /\b(?:url|image-set|-webkit-image-set|image|cross-fade|src)\s*\(/i;
  const REMOTE_REF = /(?:^|[\s"'(,])(?:https?:)?\/\//i;

  let styleEl = null;
  let previewEl = null;
  let headObserver = null;
  let lastRules = [];
  let renderedCss = null;
  let suspendedId = null;
  let suspendTimer = 0;
  const selectorProbe = document.createDocumentFragment();

  /* ------------------------------------------------------------------ <style> management */

  function createStyle(id) {
    const el = document.createElement('style');
    el.id = id;
    return el;
  }

  function attach(el) {
    const parent = document.head || document.documentElement;
    if (el.parentNode !== parent) parent.appendChild(el);
  }

  /** Inserts the stylesheet as early as possible (document_start) and keeps it in <head>. */
  function mount() {
    if (!styleEl) styleEl = document.getElementById(C.STYLE_ELEMENT_ID) || createStyle(C.STYLE_ELEMENT_ID);
    attach(styleEl);
    if (document.head) {
      observeHead();
    } else {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          attach(styleEl);
          if (previewEl) attach(previewEl);
          observeHead();
        },
        { once: true },
      );
    }
  }

  function observeHead() {
    if (headObserver || !document.head) return;
    // childList only, no subtree: it fires just when Slack adds/removes tags in <head>.
    headObserver = new MutationObserver(() => {
      if (styleEl && !styleEl.isConnected) attach(styleEl);
      if (previewEl && !previewEl.isConnected) attach(previewEl);
    });
    headObserver.observe(document.head, { childList: true });
  }

  /* ------------------------------------------------------------------ CSS generation */

  /** Syntax check without touching the document (querySelector on an empty fragment). */
  function isValidSelector(selector) {
    if (typeof selector !== 'string' || !selector.trim()) return false;
    try {
      selectorProbe.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  }

  function block(selectors, declarations) {
    return `${selectors.join(',\n')} {\n${declarations.map((d) => `  ${d} !important;`).join('\n')}\n}`;
  }

  function formatOpacity(value) {
    const n = Number(value);
    return String(Number.isFinite(n) ? Math.min(1, Math.max(0, Math.round(n * 100) / 100)) : 0.2);
  }

  /** What must be hovered to reveal a "hover" rule. `t` is the already wrapped target. */
  function revealSelectors(t, options) {
    let ancestor = null;
    if (options.hoverTarget === 'container') ancestor = `:is(${C.HOVER_CONTAINERS.join(', ')})`;
    else if (options.hoverTarget === 'ancestor' && isValidSelector(options.hoverAncestor)) ancestor = `:is(${options.hoverAncestor})`;
    if (ancestor) return [`${ancestor}:hover ${t}`, `${ancestor}:focus-within ${t}`, `${t}:focus-within`];
    // Immediate parent.
    return [`:hover > ${t}`, `:focus-within > ${t}`, `${t}:focus-within`];
  }

  function compactDeclarations(options) {
    if (options.compactMode !== 'zero' && options.compactValues) {
      const declarations = ['padding', 'margin', 'gap']
        .filter((key) => options.compactValues[key])
        .map((key) => `${key}: ${options.compactValues[key]}`);
      if (declarations.length) return declarations;
    }
    return ['padding: 0', 'margin: 0'];
  }

  /**
   * CSS for one of the built-in actions. The target is wrapped in :is() so that any selector list
   * works and the "reveal" selectors (one extra pseudo-class) always win on specificity.
   * @param {string} action
   * @param {string} selector
   * @param {import('../shared/storage.js').RuleOptions} [options]
   * @returns {string} '' when nothing has to be injected
   */
  function buildActionCss(action, selector, options) {
    if (!isValidSelector(selector)) return '';
    const o = options || {};
    const t = `:is(${selector})${NOT_UI}`;
    switch (action) {
      case 'hide':
        return block([t], ['display: none']);
      case 'hover':
        return [block([t], ['opacity: 0', `transition: ${TRANSITION}`]), block(revealSelectors(t, o), ['opacity: 1'])].join('\n');
      case 'fade': {
        const css = [block([t], [`opacity: ${formatOpacity(o.opacity)}`, `transition: ${TRANSITION}`])];
        if (o.restoreOnHover !== false) css.push(block([`${t}:hover`, `${t}:focus-within`], ['opacity: 1']));
        return css.join('\n');
      }
      case 'compact':
        return block([t], compactDeclarations(o));
      case 'collapse':
        // The toggle button itself is injected by dom-mutations.js; CSS only hides the block.
        return o.collapsed === false ? '' : block([t], ['display: none']);
      default:
        return '';
    }
  }

  /* ------------------------------------------------------------------ sanitization */

  function stripRemoteResources(rules) {
    for (const rule of Array.from(rules)) {
      if (rule.style) {
        for (let i = rule.style.length - 1; i >= 0; i--) {
          const property = rule.style[i];
          const value = rule.style.getPropertyValue(property);
          if (RESOURCE_FN.test(value) && REMOTE_REF.test(value)) rule.style.removeProperty(property);
        }
      }
      if (rule.cssRules) stripRemoteResources(rule.cssRules);
    }
  }

  /**
   * Parses CSS with the browser's own parser and serializes it back: unbalanced braces or strings
   * are closed, @import is ignored and remote url()/image-set() references are removed.
   * @returns {string} '' when nothing valid remains
   */
  function sanitizeCss(css) {
    if (typeof css !== 'string' || !css.trim()) return '';
    let sheet;
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
    } catch {
      return '';
    }
    stripRemoteResources(sheet.cssRules);
    return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
  }

  function commentText(text) {
    return String(text).replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ').slice(0, 80);
  }

  /** Full, sanitized CSS of a stored rule (with a debug comment). */
  function buildRuleCss(rule) {
    const raw = rule.action === 'custom' ? rule.css : buildActionCss(rule.action, rule.selector, rule.options);
    const css = sanitizeCss(raw);
    return css ? `/* ${commentText(rule.label || C.ACTIONS[rule.action]?.label || rule.action)} · ${rule.id} */\n${css}` : '';
  }

  /* ------------------------------------------------------------------ public API */

  /**
   * Replaces the injected CSS with the given rules (disabled ones are skipped).
   * The <style> text is only touched when the generated CSS actually changes.
   * @param {import('../shared/storage.js').Rule[]} rules
   */
  function render(rules) {
    lastRules = Array.isArray(rules) ? rules : [];
    const css = lastRules
      .filter((rule) => rule.enabled && rule.id !== suspendedId)
      .map(buildRuleCss)
      .filter(Boolean)
      .join('\n\n');
    if (css === renderedCss) return;
    renderedCss = css;
    if (!styleEl) mount();
    styleEl.textContent = css;
  }

  /** Temporary CSS used by the inspector for live previews. */
  function setPreview(css) {
    if (!previewEl) previewEl = createStyle(C.PREVIEW_STYLE_ELEMENT_ID);
    attach(previewEl);
    previewEl.textContent = sanitizeCss(css);
  }

  function clearPreview() {
    if (!previewEl) return;
    previewEl.remove();
    previewEl = null;
  }

  /**
   * Stops applying one rule (while it is edited, or for a few seconds to show what it hides).
   * @param {string|null} ruleId  null resumes everything
   * @param {number} [durationMs] auto-resume after this delay
   */
  function suspend(ruleId, durationMs = 0) {
    clearTimeout(suspendTimer);
    suspendedId = ruleId || null;
    render(lastRules);
    if (suspendedId && durationMs > 0) suspendTimer = setTimeout(() => suspend(null), durationMs);
  }

  SUT.styleEngine = Object.freeze({
    mount,
    render,
    buildActionCss,
    buildRuleCss,
    sanitizeCss,
    isValidSelector,
    setPreview,
    clearPreview,
    suspend,
  });
})(globalThis);
