/**
 * Slack UI Tweaker — robust CSS selector generator.
 *
 * Slack is a React app whose class names are mostly generated or state-dependent, so the generator
 * builds selectors out of the most stable signals available, in this order of preference:
 *   1. Slack's own test hooks: [data-qa], [data-testid], [data-sk] (and [data-qa-*] flags)
 *   2. Semantic accessibility attributes: [aria-label], [name], [role]
 *   3. Stable ids (runtime-generated ids are rejected)
 *   4. Hierarchy: stable ancestor + tag/attributes, e.g. [data-qa="channel_sidebar"] div[role="treeitem"]
 * Slack's BEM-like design-system classes (c-…, p-…) are accepted with low priority, only when they
 * carry no hash, no long digit runs and no state modifier. Structural nth-of-type paths are the
 * last resort and are flagged as `fragile`.
 *
 * Every value goes through isDynamicValue(), which rejects Slack ids (C0123ABCD, U0…), timestamps,
 * counters, UUIDs, React useId() values and hash-looking tokens.
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});

  /** [attribute, score] — Slack's test hooks are the most stable anchors in its DOM. */
  const STABLE_ATTRS = [['data-qa', 100], ['data-testid', 96], ['data-sk', 92]];
  /** Accessibility attributes: semantic, but aria-label can be localized or bound to content. */
  const SEMANTIC_ATTRS = [['aria-label', 74], ['name', 70], ['role', 62]];
  const SCORE = Object.freeze({ qaFlag: 80, qaPresence: 76, prefixPenalty: 30, id: 56, cls: 40, tag: 4 });

  const MAX_ANCESTOR_DEPTH = 12;
  /** findContainers walks further up than anchoredSelector (page-level containers), but not unbounded. */
  const MAX_CONTAINER_DEPTH = 24;
  const MAX_ANCHOR_CANDIDATES = 8;
  const MAX_QA_FLAGS = 3;
  /** "Similar" selectors matching more than this are probably too broad. */
  const BROAD_MATCH_LIMIT = 400;

  const STATE_WORDS =
    /(?:^|[_-])(?:active|selected|hover(?:ed)?|focus(?:ed)?|unread|highlight(?:ed)?|open(?:ed)?|closed|collapsed|expanded|visible|hidden|loading|disabled|checked|current|dragging|pressed)(?:$|[_-])/;
  const GENERATED_PREFIX = /^(?:css|sc|jsx|emotion|svelte|ember|react|radix|headlessui|mui|chakra|ext-gen|yui)[-_:]/i;

  /* ------------------------------------------------------------------ heuristics */

  /** True when an attribute value looks generated at runtime (and would break on the next render). */
  function isDynamicValue(value) {
    const v = String(value).trim();
    if (!v || v.length > 80) return true;
    if (/\d{3,}/.test(v)) return true; // timestamps (1700000000.123456), counters, numeric ids
    if (/^:.+:$/.test(v)) return true; // React useId(): ":r1:", ":R2la:"
    if (GENERATED_PREFIX.test(v)) return true; // CSS-in-JS / framework generated
    if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) return true; // UUID
    for (const token of v.split(/[^A-Za-z0-9]+/)) {
      if (!token) continue;
      // Slack object ids: C0123ABCD (channels), U0…/W0… (users), T0…/E0… (teams)…
      if (/^[A-Z][A-Z0-9]{7,}$/.test(token) && /\d/.test(token)) return true;
      // Hash-like tokens: letters and digits mixed together.
      if (token.length >= 6 && /\d/.test(token) && /[A-Za-z]/.test(token)) {
        const digits = token.replace(/\D/g, '').length;
        if (digits >= 2 || (/[a-z]/.test(token) && /[A-Z]/.test(token))) return true;
      }
    }
    return false;
  }

  /** Slack design-system classes (c-message_kit__gutter, p-channel_sidebar…) without modifiers. */
  function isStableClass(cls) {
    return /^[cp]-[a-z0-9_]+(?:-[a-z0-9_]+)*$/.test(cls) && !/\d{3,}/.test(cls) && !STATE_WORDS.test(cls);
  }

  /** "channel_sidebar_name_general" → "channel_sidebar_name_" (used to target similar elements). */
  function stablePrefix(value) {
    const match = /^(.*[_-])[^_-]+$/.exec(value);
    if (!match || match[1].length < 4 || isDynamicValue(match[1])) return null;
    return match[1];
  }

  function quote(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\a ')}"`;
  }

  /* ------------------------------------------------------------------ DOM queries */

  /** @returns {Element[]} matches (empty on invalid selector), at most `limit` */
  function queryAll(selector, limit = Infinity, scope = document) {
    let list;
    try {
      list = scope.querySelectorAll(selector);
    } catch {
      return [];
    }
    return list.length > limit ? Array.prototype.slice.call(list, 0, limit) : Array.from(list);
  }

  /**
   * Cache of document-wide queries, alive only while one public call runs: the DOM cannot change
   * in the middle of a synchronous call, and the cache is dropped before Slack can mutate it again.
   * The same selector is otherwise queried several times per click (unique search, similar
   * search, result counts) on Slack's very large DOM.
   * @type {Map<string, NodeList|null>|null}
   */
  let memo = null;

  function withMemo(fn) {
    if (memo) return fn();
    memo = new Map();
    try {
      return fn();
    } finally {
      memo = null;
    }
  }

  function documentMatches(selector) {
    if (memo && memo.has(selector)) return memo.get(selector);
    let list;
    try {
      list = document.querySelectorAll(selector);
    } catch {
      list = null;
    }
    if (memo) memo.set(selector, list);
    return list;
  }

  /** @returns {number} number of matches in the document, -1 when the selector is invalid */
  function count(selector) {
    const list = documentMatches(selector);
    return list ? list.length : -1;
  }

  function isUniqueFor(selector, el) {
    const list = documentMatches(selector);
    return !!list && list.length === 1 && list[0] === el;
  }

  function matchesSafe(el, selector) {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------------ selector parts */

  /**
   * @typedef {Object} Part  A simple selector fragment describing one element
   * @property {string} text          e.g. '[data-qa="x"]', '#id', '.c-foo' ('' for tag-only)
   * @property {number} score         higher = more stable
   * @property {boolean} [withTag]    prefix with the tag name when rendered (role, tag-only)
   * @property {boolean} [generic]    shared by many elements by nature (role, class, prefix…)
   * @property {boolean} [contentBound] depends on user content (aria-label): never used for "similar"
   * @property {boolean} [tagOnly]
   */

  /** @returns {Part[]} sorted by score, best first; always ends with the tag-only part */
  function partsOf(el) {
    /** @type {Part[]} */
    const parts = [];
    for (const [name, score] of STABLE_ATTRS) {
      const value = el.getAttribute(name);
      if (!value) continue;
      if (!isDynamicValue(value)) parts.push({ text: `[${name}=${quote(value)}]`, score });
      const prefix = stablePrefix(value);
      if (prefix) parts.push({ text: `[${name}^=${quote(prefix)}]`, score: score - SCORE.prefixPenalty, generic: true });
    }
    let flags = 0;
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith('data-qa-') || flags >= MAX_QA_FLAGS) continue;
      flags++;
      const name = CSS.escape(attr.name);
      if (attr.value && !isDynamicValue(attr.value)) {
        parts.push({ text: `[${name}=${quote(attr.value)}]`, score: SCORE.qaFlag, generic: true });
      } else {
        parts.push({ text: `[${name}]`, score: SCORE.qaPresence, generic: true });
      }
    }
    for (const [name, score] of SEMANTIC_ATTRS) {
      const value = el.getAttribute(name);
      if (!value) continue;
      if (name === 'role') {
        parts.push({ text: `[role=${quote(value)}]`, score, generic: true, withTag: true });
        continue;
      }
      // Labels with digits are usually counters or times ("3 new messages", "10:32").
      if (isDynamicValue(value) || (name === 'aria-label' && (/\d/.test(value) || value.length > 60))) continue;
      parts.push({ text: `[${name}=${quote(value)}]`, score, contentBound: name === 'aria-label' });
    }
    const id = el.getAttribute('id');
    if (id && !isDynamicValue(id)) parts.push({ text: `#${CSS.escape(id)}`, score: SCORE.id });
    for (const cls of Array.from(el.classList)) {
      if (isStableClass(cls)) parts.push({ text: `.${CSS.escape(cls)}`, score: SCORE.cls, generic: true });
    }
    parts.sort((a, b) => b.score - a.score);
    parts.push({ text: '', score: SCORE.tag, generic: true, withTag: true, tagOnly: true });
    return parts;
  }

  /** Compound selector for `el` made of the given parts. */
  function render(el, parts) {
    const tag = parts.some((p) => p.withTag) ? CSS.escape(el.localName) : '';
    return tag + parts.map((p) => p.text).join('');
  }

  function nthStep(node) {
    const tag = CSS.escape(node.localName);
    const parent = node.parentElement;
    if (!parent) return tag;
    const sameTag = Array.from(parent.children).filter((child) => child.localName === node.localName);
    return sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag;
  }

  /* ------------------------------------------------------------------ unique selector */

  /**
   * @typedef {Object} SelectorResult
   * @property {string} selector
   * @property {number} count       matches in the current document
   * @property {boolean} fragile    relies on DOM structure (nth-of-type)
   * @property {boolean} [similar]  (similarSelector) true when it matches more than one element
   */

  /** Selector matching exactly `el`. @returns {SelectorResult} */
  function uniqueSelector(el) {
    // A detached node (Slack re-rendered it) has no ancestors to anchor to: the structural fallback
    // would degrade to a bare tag such as `div`. Report it as invalid instead of guessing.
    if (!el.isConnected) return { selector: '', count: -1, fragile: true };
    return withMemo(() => findUnique(el));
  }

  function findUnique(el) {
    const parts = partsOf(el);
    const strong = parts.filter((p) => !p.tagOnly);

    // 1. One attribute of the element itself.
    for (const part of strong) {
      const selector = render(el, [part]);
      if (isUniqueFor(selector, el)) return result(selector, false, 1);
    }
    // 2. Two attributes combined, e.g. div[role="treeitem"][aria-label="general"].
    const top = strong.slice(0, 5);
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const selector = render(el, [top[i], top[j]]);
        if (isUniqueFor(selector, el)) return result(selector, false, 1);
      }
    }
    // 3. Anchored to a stable ancestor.
    const anchored = anchoredSelector(el, parts);
    if (anchored) return result(anchored, false, 1);
    // 4. Structural path from the closest unique ancestor (fragile).
    return structuralSelector(el);
  }

  function anchoredSelector(el, parts) {
    const targets = [...parts.filter((p) => !p.tagOnly).slice(0, 4), parts[parts.length - 1]];
    const found = [];
    let depth = 0;
    for (let a = el.parentElement; a && a !== document.documentElement && depth < MAX_ANCESTOR_DEPTH; a = a.parentElement, depth++) {
      const anchors = partsOf(a).filter((p) => !p.tagOnly).slice(0, 3);
      for (const anchorPart of anchors) {
        const anchorSelector = render(a, [anchorPart]);
        for (const targetPart of targets) {
          const targetSelector = render(el, [targetPart]);
          // Cheap pre-check: if the anchor already contains several matches, a descendant
          // combinator cannot be unique (a child combinator still might, for the direct parent).
          const ambiguous = queryAll(targetSelector, 2, a).length > 1;
          const combinators = depth === 0 ? [' > ', ' '] : [' '];
          for (const combinator of combinators) {
            if (combinator === ' ' && ambiguous) continue;
            const selector = anchorSelector + combinator + targetSelector;
            if (isUniqueFor(selector, el)) found.push({ selector, score: anchorPart.score + targetPart.score - depth * 4 });
          }
        }
        if (found.length >= MAX_ANCHOR_CANDIDATES) break;
      }
      if (found.length >= MAX_ANCHOR_CANDIDATES) break;
    }
    if (!found.length) return null;
    found.sort((x, y) => y.score - x.score);
    return found[0].selector;
  }

  /** @returns {SelectorResult} */
  function structuralSelector(el) {
    const steps = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (node === document.body) {
        steps.unshift('body');
        break;
      }
      if (node !== el) {
        const anchor = partsOf(node)
          .filter((p) => !p.tagOnly)
          .map((p) => render(node, [p]))
          .find((selector) => isUniqueFor(selector, node));
        if (anchor) {
          steps.unshift(anchor);
          break;
        }
      }
      steps.unshift(nthStep(node));
    }
    return result(steps.join(' > '), true);
  }

  /** `knownCount` skips a query when the caller already proved the selector unique. */
  function result(selector, fragile, knownCount) {
    return { selector, count: knownCount === undefined ? count(selector) : knownCount, fragile };
  }

  /* ------------------------------------------------------------------ similar selector */

  /** Closest ancestors with a unique, non content-bound part: the "containers". */
  function findContainers(el, max) {
    const out = [];
    let depth = 0;
    for (
      let a = el.parentElement;
      a && a !== document.body && a !== document.documentElement && depth < MAX_CONTAINER_DEPTH;
      a = a.parentElement, depth++
    ) {
      const part = partsOf(a).find((p) => !p.tagOnly && !p.contentBound && isUniqueFor(render(a, [p]), a));
      if (part) {
        out.push({ el: a, selector: render(a, [part]), depth });
        if (out.length >= max) break;
      }
    }
    return out;
  }

  /** Closest ancestors whose stable part is shared by several elements: list items, messages… */
  function findRepeatingAncestors(el, max) {
    const out = [];
    let distance = 1;
    for (let a = el.parentElement; a && a !== document.body && distance <= 8; a = a.parentElement, distance++) {
      for (const part of partsOf(a)) {
        if (part.tagOnly || part.contentBound) continue;
        const selector = render(a, [part]);
        if (count(selector) >= 2) {
          out.push({ el: a, selector, score: part.score, distance });
          break;
        }
      }
      if (out.length >= max) break;
    }
    return out;
  }

  function childPath(ancestor, el) {
    const steps = [];
    for (let node = el; node && node !== ancestor; node = node.parentElement) steps.unshift(CSS.escape(node.localName));
    return steps.join(' > ');
  }

  /**
   * Selector matching `el` and the elements similar to it, preferably scoped to a stable container
   * (e.g. every channel row of the sidebar). Falls back to the unique selector.
   * @param {Element} el
   * @param {SelectorResult} [uniqueResult] already computed uniqueSelector(el), reused as fallback
   * @returns {SelectorResult}
   */
  function similarSelector(el, uniqueResult) {
    if (!el.isConnected) return { selector: '', count: -1, fragile: true, similar: false };
    return withMemo(() => findSimilar(el, uniqueResult));
  }

  function findSimilar(el, uniqueResult) {
    const parts = partsOf(el).filter((p) => !p.tagOnly && !p.contentBound);
    const containers = findContainers(el, 3);
    const seen = new Set();
    let best = null;

    const consider = (selector, score) => {
      if (seen.has(selector)) return;
      seen.add(selector);
      const n = count(selector);
      if (n < 2 || !matchesSafe(el, selector)) return;
      const adjusted = n > BROAD_MATCH_LIMIT ? score - 40 : score;
      if (!best || adjusted > best.score) best = { selector, count: n, score: adjusted };
    };

    for (const part of parts) {
      const own = render(el, [part]);
      consider(own, part.score);
      for (const container of containers) consider(`${container.selector} ${own}`, part.score + 12 - container.depth * 0.5);
    }
    // Same structural position inside a repeating item: [data-qa="message_container"] > div > span
    for (const item of findRepeatingAncestors(el, 2)) {
      const selector = `${item.selector} > ${childPath(item.el, el)}`;
      const score = 24 + item.score * 0.25 - item.distance * 3;
      consider(selector, score);
      for (const container of containers) {
        if (container.el !== item.el && container.el.contains(item.el)) consider(`${container.selector} ${selector}`, score + 12);
      }
    }

    if (best) return { selector: best.selector, count: best.count, fragile: false, similar: true };
    return { ...(uniqueResult || findUnique(el)), similar: false };
  }

  /* ------------------------------------------------------------------ helpers for the UI */

  /** Cheap description for the hover tooltip (no DOM queries). */
  function describe(el) {
    const best = partsOf(el).find((p) => !p.tagOnly);
    return { tag: el.localName, hint: best ? render(el, [best]) : '' };
  }

  /** @returns {{ok: boolean, count: number, error?: string}} */
  function validate(selector) {
    if (typeof selector !== 'string' || !selector.trim()) return { ok: false, count: 0, error: 'Selettore vuoto' };
    const n = count(selector);
    return n < 0 ? { ok: false, count: 0, error: 'Selettore non valido' } : { ok: true, count: n };
  }

  SUT.selectorGenerator = Object.freeze({
    isDynamicValue,
    isStableClass,
    partsOf,
    describe,
    uniqueSelector,
    similarSelector,
    validate,
    count,
    queryAll,
  });
})(globalThis);
