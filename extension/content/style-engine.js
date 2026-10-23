/**
 * Slack UI Tweaker — Style Engine.
 *
 * Turns rules into CSS and keeps it in a single <style id="slack-ui-tweaker-styles"> in <head>.
 * The stylesheet is static between rule changes: Slack's SPA navigation (channel switch, threads,
 * search) and its virtualized lists re-render DOM nodes that are matched by the same CSS instantly,
 * so there is no flicker and no per-node JavaScript work.
 *
 * Every rule's CSS is parsed with a constructable stylesheet and re-serialized before injection, so a
 * malformed rule cannot swallow the next ones. The sanitizer fails closed: only allowlisted rule types
 * survive, and a declaration that could make the browser fetch anything is dropped unless every URL it
 * references is a data: URI (or an in-page #id where that cannot trigger a fetch). Same-origin URLs are
 * dropped too, so an imported backup cannot make Slack load or leak anything.
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});
  const C = SUT.constants;

  /** Never apply rules to the nodes we inject (UI host, collapse toggles). */
  const NOT_UI = `:not([${C.UI_ATTR}])`;
  const TRANSITION = 'opacity 0.15s ease-in-out';

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

  /*
   * Regexes over a value cannot tell where its URLs are (the URL parser reads `https:/\h` as https://h, and
   * escapes, var() and shorthands hide them), so the sanitizer tokenizes the serialized declarations the way the
   * CSS parser does and only keeps URLs that provably load nothing. See the "Validate origins" guide of Modern Web
   * Guidance: no string matching on URLs, parse them.
   */

  /**
   * Rule types allowed in injected CSS; anything else (@property, @function, @page, @counter-style, @namespace…)
   * is dropped. Compared by name because several of these interfaces do not exist in every supported Chrome.
   */
  const SAFE_RULE_TYPES = new Set([
    'CSSStyleRule',
    'CSSNestedDeclarations',
    'CSSMediaRule',
    'CSSSupportsRule',
    'CSSContainerRule',
    'CSSLayerBlockRule',
    'CSSLayerStatementRule',
    'CSSScopeRule',
    'CSSStartingStyleRule',
    'CSSFontFaceRule',
    'CSSKeyframesRule',
    'CSSKeyframeRule',
  ]);
  /** Functions that make the browser fetch their URL arguments. */
  const RESOURCE_FNS = new Set(['url', 'src', 'image', 'image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade']);
  /** Functions that pull tokens from elsewhere (custom properties, attributes, the UA); dashed custom functions too. */
  const SUBSTITUTION_FNS = new Set(['var', 'env', 'attr', 'if', 'inherit']);
  /** String arguments of these functions are names, not URLs (@font-face src, image-set() type()). */
  const NAME_FNS = new Set(['format', 'local', 'tech', 'type']);
  /** Properties whose url("#id") references an element of the page; elsewhere it re-fetches the page itself. */
  const FRAGMENT_PROPERTIES = new Set([
    'filter',
    'backdrop-filter',
    'clip-path',
    'mask',
    'mask-image',
    'marker',
    'marker-start',
    'marker-mid',
    'marker-end',
    'fill',
    'stroke',
  ]);
  const CLOSERS = { '(': ')', '[': ']', '{': '}' };

  const NEWLINE = /[\n\r\f]/;
  const WHITESPACE = /[ \t\n\r\f]/;
  const NON_PRINTABLE = /[\0-\x08\x0b\x0e-\x1f\x7f]/;
  const HEX_ESCAPE = /[0-9a-f]{1,6}/iy;
  const NUMBER = /[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/iy;
  const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
  const isNameStart = (c) => c !== undefined && (/[a-z_]/i.test(c) || c > '\x7f');
  const isNameChar = (c) => isNameStart(c) || (c !== undefined && /[0-9-]/.test(c));

  /**
   * Splits CSS text into the tokens the sanitizer needs, following CSS Syntax §4: comments, escapes, strings,
   * url(), numbers with units, hashes. Escapes are decoded and function names lower-cased. A string, url() or
   * comment left open becomes a 'bad' token: once injected, it would swallow the CSS that follows.
   * @param {string} text
   * @returns {{type: 'ident'|'function'|'url'|'string'|'delim'|'bad', value?: string}[]}
   */
  function tokenize(text) {
    const tokens = [];
    const n = text.length;
    let i = 0;

    const isEscape = (at) => text[at] === '\\' && !NEWLINE.test(text[at + 1] || '');
    const startsName = (at) => isNameStart(text[at]) || isEscape(at);
    const startsIdent = (at) => (text[at] === '-' ? text[at + 1] === '-' || startsName(at + 1) : startsName(at));

    /** Decodes the escape whose backslash is at text[i]. */
    function readEscape() {
      i++;
      HEX_ESCAPE.lastIndex = i;
      const hex = HEX_ESCAPE.exec(text);
      if (!hex) {
        if (i >= n) return REPLACEMENT_CHAR;
        const ch = String.fromCodePoint(text.codePointAt(i));
        i += ch.length;
        return ch;
      }
      i += hex[0].length;
      if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
      else if (WHITESPACE.test(text[i] || '')) i++;
      const cp = parseInt(hex[0], 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? REPLACEMENT_CHAR : String.fromCodePoint(cp);
    }

    function readName() {
      let s = '';
      while (i < n) {
        if (isNameChar(text[i])) s += text[i++];
        else if (isEscape(i)) s += readEscape();
        else break;
      }
      return s;
    }

    function readString(quote) {
      let s = '';
      i++;
      while (i < n) {
        const c = text[i];
        if (c === quote) {
          i++;
          return { type: 'string', value: s };
        }
        if (NEWLINE.test(c)) break;
        if (c !== '\\') {
          s += c;
          i++;
        } else if (NEWLINE.test(text[i + 1] || '')) {
          i += text[i + 1] === '\r' && text[i + 2] === '\n' ? 3 : 2;
        } else if (i + 1 < n) {
          s += readEscape();
        } else {
          i++;
        }
      }
      return { type: 'bad' };
    }

    /** Unquoted url(…); `i` is just past the parenthesis. */
    function readUrl() {
      let s = '';
      while (WHITESPACE.test(text[i] || '')) i++;
      while (i < n) {
        const c = text[i];
        if (c === ')') {
          i++;
          return { type: 'url', value: s };
        }
        if (WHITESPACE.test(c)) {
          while (WHITESPACE.test(text[i] || '')) i++;
          if (text[i] === ')') continue;
          break;
        }
        if (c === '"' || c === "'" || c === '(' || NON_PRINTABLE.test(c) || (c === '\\' && !isEscape(i))) break;
        s += c === '\\' ? readEscape() : text[i++];
      }
      // Bad or unterminated url(): skip its remnants like the CSS tokenizer does.
      while (i < n && text[i] !== ')') {
        if (isEscape(i)) readEscape();
        else i++;
      }
      i++;
      return { type: 'bad' };
    }

    function readNumber() {
      NUMBER.lastIndex = i;
      if (!NUMBER.test(text)) return false;
      i = NUMBER.lastIndex;
      if (startsIdent(i)) readName();
      else if (text[i] === '%') i++;
      return true;
    }

    while (i < n) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) {
          tokens.push({ type: 'bad' });
          break;
        }
        i = end + 2;
      } else if (WHITESPACE.test(c)) {
        i++;
      } else if (c === '"' || c === "'") {
        tokens.push(readString(c));
      } else if (readNumber()) {
        // Numbers, dimensions and percentages cannot reference anything.
      } else if (c === '#' || c === '@') {
        i++;
        if (isNameChar(text[i]) || isEscape(i)) readName();
      } else if (startsIdent(i)) {
        const ident = readName();
        if (text[i] !== '(') {
          tokens.push({ type: 'ident', value: ident });
          continue;
        }
        i++;
        const fn = ident.toLowerCase();
        let next = i;
        while (WHITESPACE.test(text[next] || '')) next++;
        if (fn === 'url' && text[next] !== '"' && text[next] !== "'") tokens.push(readUrl());
        else tokens.push({ type: 'function', value: fn });
      } else {
        tokens.push({ type: 'delim', value: c });
        i++;
      }
    }
    return tokens;
  }

  /**
   * Describes one declaration ("name: value") by what its value can make the browser do: the functions it calls,
   * the URLs it references (url() contents and strings given to url-taking functions), and its other strings.
   * `bad` when the value is not self-contained (open string, url(), comment or bracket).
   */
  function describeDeclaration(tokens) {
    const decl = { name: null, fns: new Set(), urls: [], strings: [], bad: true };
    const [name, colon] = tokens;
    if (name?.type !== 'ident' || colon?.type !== 'delim' || colon.value !== ':') return decl;
    decl.name = name.value;
    decl.bad = false;
    const open = [];
    for (const token of tokens.slice(2)) {
      const fn = open.length ? open[open.length - 1].fn : '';
      if (token.type === 'bad') {
        decl.bad = true;
      } else if (token.type === 'function') {
        decl.fns.add(token.value);
        open.push({ fn: token.value, close: ')' });
      } else if (token.type === 'url') {
        decl.fns.add('url');
        decl.urls.push(token.value);
      } else if (token.type === 'string') {
        if (RESOURCE_FNS.has(fn)) decl.urls.push(token.value);
        else decl.strings.push({ value: token.value, fn });
      } else if (token.type === 'delim' && CLOSERS[token.value]) {
        open.push({ fn: '', close: CLOSERS[token.value] });
      } else if (token.type === 'delim' && ')]}'.includes(token.value)) {
        if (open.length && open[open.length - 1].close === token.value) open.pop();
        else decl.bad = true;
      }
    }
    if (open.length) decl.bad = true;
    return decl;
  }

  /** Reads a serialized declaration block ("a: b; c: d;") into described declarations. */
  function readDeclarations(text) {
    const lists = [[]];
    let depth = 0;
    for (const token of tokenize(text)) {
      if (token.type === 'function' || (token.type === 'delim' && CLOSERS[token.value])) depth++;
      else if (token.type === 'delim' && ')]}'.includes(token.value)) depth--;
      if (depth === 0 && token.type === 'delim' && token.value === ';') lists.push([]);
      else lists[lists.length - 1].push(token);
    }
    return lists.filter((list) => list.length).map(describeDeclaration);
  }

  /** True for references that load nothing: data: URIs, and "#id" where `fragments` allows them. */
  function isEmbeddedUrl(url, fragments = false) {
    if (url.startsWith('#')) return fragments;
    try {
      return new URL(url, location.href).protocol === 'data:';
    } catch {
      return false;
    }
  }

  function isUnsafe(decl) {
    if (decl.bad) return true;
    const fns = Array.from(decl.fns);
    const loads = fns.some((fn) => RESOURCE_FNS.has(fn));
    if (decl.name.startsWith('--')) {
      // var() can carry a custom property's strings into image-set()/src(), in our CSS or in Slack's.
      if (decl.fns.has('attr') || decl.strings.some((s) => !isEmbeddedUrl(s.value))) return true;
    } else if (!loads) {
      return false;
    } else if (decl.strings.some((s) => !NAME_FNS.has(s.fn) && !isEmbeddedUrl(s.value))) {
      return true;
    }
    // A substituted value is only known at computed-value time: never let one reach a url-taking function.
    if (loads && fns.some((fn) => SUBSTITUTION_FNS.has(fn) || fn.startsWith('--'))) return true;
    const fragments = FRAGMENT_PROPERTIES.has(decl.name) && fns.every((fn) => fn === 'url' || !RESOURCE_FNS.has(fn));
    return !decl.urls.every((url) => isEmbeddedUrl(url, fragments));
  }

  /**
   * Checks the block as serialized (that text is what gets injected: shorthands with var() only appear there)
   * and removes unsafe declarations; empties the block if one of them cannot be removed by name.
   * @param {CSSStyleDeclaration} style
   */
  function cleanDeclarations(style) {
    for (const decl of readDeclarations(style.cssText)) {
      if (decl.name && isUnsafe(decl)) style.removeProperty(decl.name);
    }
    if (readDeclarations(style.cssText).some(isUnsafe)) style.cssText = '';
  }

  /**
   * Cleans an allowlisted rule and its children in place.
   * @returns {boolean} false when the rule must be dropped
   */
  function cleanRule(rule) {
    if (!SAFE_RULE_TYPES.has(rule.constructor.name)) return false;
    if (rule.style) cleanDeclarations(rule.style);
    if (!rule.cssRules) return true;
    for (let i = rule.cssRules.length - 1; i >= 0; i--) {
      if (cleanRule(rule.cssRules[i])) continue;
      // CSSKeyframesRule.deleteRule() takes a keyframe selector, not an index: drop the whole @keyframes.
      if (rule.constructor.name === 'CSSKeyframesRule') return false;
      rule.deleteRule(i);
    }
    return true;
  }

  function parseRules(css) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet.cssRules;
  }

  /**
   * Parses CSS with the browser's own parser and serializes it back: unbalanced braces or strings are closed,
   * @import is ignored, unknown rule types are dropped and so is any declaration that could fetch something.
   * @returns {string} '' when nothing valid remains
   */
  function sanitizeCss(css) {
    if (typeof css !== 'string' || !css.trim()) return '';
    try {
      // Top-level rules are filtered rather than deleted: deleting an @namespace rule throws.
      const out = Array.from(parseRules(css)).filter(cleanRule).map((rule) => rule.cssText).join('\n');
      // The injected text must parse back to exactly what was checked, or it could also swallow the next rules.
      return out && Array.from(parseRules(out), (rule) => rule.cssText).join('\n') === out ? out : '';
    } catch {
      return '';
    }
  }

  function commentText(text) {
    return String(text).replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ').slice(0, 80);
  }

  /** Full, sanitized CSS of a stored rule (with a debug comment). */
  function buildRuleCss(rule) {
    const raw = rule.action === 'custom' ? rule.css : buildActionCss(rule.action, rule.selector, rule.options);
    const css = sanitizeCss(raw);
    // The id goes through commentText() too: a stray "*/" must never turn unsanitized text into CSS.
    return css ? `/* ${commentText(rule.label || C.ACTIONS[rule.action]?.label || rule.action)} · ${commentText(rule.id)} */\n${css}` : '';
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
