/**
 * Slack UI Tweaker — typed helpers around chrome.storage.local.
 *
 * Storage layout (chrome.storage.local):
 *   sutSettings   → Settings
 *   sutRules      → { [scope]: Rule[] }  scope = 'global' or a Slack team/enterprise id (T0123…, E0123…)
 *   sutWorkspaces → { [teamId]: { name, lastSeen } }  display names for the popup
 *
 * Loaded as a classic script by the content script (isolated world) and by the popup.
 * Every write goes through normalizeRule(), so whatever is stored (or imported) has a known shape.
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});
  const C = SUT.constants;
  const KEYS = C.STORAGE_KEYS;
  const GLOBAL = C.GLOBAL_SCOPE;

  /**
   * @typedef {'hide'|'hover'|'fade'|'compact'|'collapse'|'custom'} RuleAction
   *
   * @typedef {Object} CompactValues  Halved spacing measured on the sample element
   * @property {string} [padding]  e.g. "4px 10px 4px 10px"
   * @property {string} [margin]
   * @property {string} [gap]
   *
   * @typedef {Object} RuleOptions
   * @property {'parent'|'container'|'ancestor'} [hoverTarget]  hover: what must be hovered to reveal the element
   * @property {string} [hoverAncestor]   hover: custom ancestor selector (hoverTarget === 'ancestor')
   * @property {number} [opacity]         fade: 0..1
   * @property {boolean} [restoreOnHover] fade: back to full opacity on hover
   * @property {'half'|'zero'} [compactMode]
   * @property {CompactValues|null} [compactValues]
   * @property {boolean} [collapsed]      collapse: current state of the toggle
   *
   * @typedef {Object} Rule
   * @property {string} id
   * @property {string} selector          CSS selector of the targeted element(s)
   * @property {RuleAction} action
   * @property {RuleOptions} options
   * @property {string} css               Hand-written CSS, only for action === 'custom'
   * @property {RuleAction|null} baseAction  Action the custom CSS was derived from (display only)
   * @property {string} label             Human readable name (may be empty)
   * @property {string} scope             'global' or a Slack team id
   * @property {boolean} enabled
   * @property {number} createdAt
   * @property {number} updatedAt
   *
   * @typedef {Object<string, Rule[]>} RulesByScope
   *
   * @typedef {Object} Settings
   * @property {boolean} enabled             Master switch
   * @property {boolean} showFloatingButton  In-page launcher
   * @property {number} floatingButtonTop    Vertical position of the launcher, % of the viewport
   *
   * @typedef {Object<string, {name: string, lastSeen: number}>} Workspaces
   *
   * @typedef {Object} ExportedConfig
   * @property {string} format
   * @property {number} version
   * @property {string} exportedAt
   * @property {RulesByScope} rules
   * @property {Workspaces} workspaces
   */

  /** @type {Readonly<Settings>} */
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    showFloatingButton: true,
    floatingButtonTop: 50,
  });

  const SCOPE_RE = /^(?:global|[A-Z0-9]{2,32})$/;
  const ID_RE = /^[\w-]{1,64}$/;
  const PX_LIST_RE = /^-?\d+(?:\.\d+)?px(?: -?\d+(?:\.\d+)?px){0,3}$/;
  const MAX_SELECTOR_LENGTH = 2000;
  const MAX_CSS_LENGTH = 20000;
  const MAX_LABEL_LENGTH = 120;

  const area = () => chrome.storage.local;
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // Serializes read-modify-write cycles issued from the same context (popup or tab).
  let queue = Promise.resolve();
  function withLock(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  function createId() {
    return `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ------------------------------------------------------------------ normalization */

  /** @returns {CompactValues|null} */
  function normalizeCompactValues(raw) {
    if (!isObject(raw)) return null;
    const out = {};
    for (const key of ['padding', 'margin', 'gap']) {
      const value = typeof raw[key] === 'string' ? raw[key].trim() : '';
      if (PX_LIST_RE.test(value)) out[key] = value;
    }
    return Object.keys(out).length ? out : null;
  }

  /** @returns {RuleOptions} */
  function normalizeOptions(action, raw) {
    const src = isObject(raw) ? raw : {};
    switch (action) {
      case 'hover':
        return {
          hoverTarget: ['parent', 'container', 'ancestor'].includes(src.hoverTarget) ? src.hoverTarget : 'parent',
          hoverAncestor: typeof src.hoverAncestor === 'string' ? src.hoverAncestor.trim().slice(0, MAX_SELECTOR_LENGTH) : '',
        };
      case 'fade': {
        const opacity = Number(src.opacity);
        return {
          opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, Math.round(opacity * 100) / 100)) : 0.2,
          restoreOnHover: src.restoreOnHover !== false,
        };
      }
      case 'compact':
        return {
          compactMode: src.compactMode === 'zero' ? 'zero' : 'half',
          compactValues: normalizeCompactValues(src.compactValues),
        };
      case 'collapse':
        return { collapsed: src.collapsed !== false };
      default:
        return {};
    }
  }

  /**
   * Validates and fills defaults. Returns null when the input cannot become a valid rule.
   * @param {any} raw
   * @returns {Rule|null}
   */
  function normalizeRule(raw) {
    if (!isObject(raw)) return null;
    const selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
    if (!selector || selector.length > MAX_SELECTOR_LENGTH) return null;
    const action = typeof raw.action === 'string' && hasOwn(C.ACTIONS, raw.action) ? raw.action : null;
    if (!action) return null;
    const css = action === 'custom' && typeof raw.css === 'string' ? raw.css.slice(0, MAX_CSS_LENGTH) : '';
    if (action === 'custom' && !css.trim()) return null;
    const baseAction =
      action === 'custom' && typeof raw.baseAction === 'string' && C.ACTION_ORDER.includes(raw.baseAction)
        ? raw.baseAction
        : null;
    const now = Date.now();
    return {
      id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : createId(),
      selector,
      action,
      options: normalizeOptions(action, raw.options),
      css,
      baseAction,
      label: typeof raw.label === 'string' ? raw.label.trim().slice(0, MAX_LABEL_LENGTH) : '',
      scope: typeof raw.scope === 'string' && SCOPE_RE.test(raw.scope) ? raw.scope : GLOBAL,
      enabled: raw.enabled !== false,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    };
  }

  /** Shape check on read (stored data was normalized on write). @returns {RulesByScope} */
  function shapeRules(raw) {
    const out = {};
    if (!isObject(raw)) return out;
    for (const [scope, list] of Object.entries(raw)) {
      if (!SCOPE_RE.test(scope) || !Array.isArray(list)) continue;
      const rules = list.filter((rule) => isObject(rule) && typeof rule.id === 'string' && typeof rule.selector === 'string');
      if (rules.length) out[scope] = rules;
    }
    return out;
  }

  /** @returns {Settings} */
  function withDefaults(raw) {
    const settings = { ...DEFAULT_SETTINGS, ...(isObject(raw) ? raw : {}) };
    settings.enabled = settings.enabled !== false;
    settings.showFloatingButton = settings.showFloatingButton !== false;
    const top = Number(settings.floatingButtonTop);
    settings.floatingButtonTop = Number.isFinite(top) ? Math.min(95, Math.max(5, top)) : DEFAULT_SETTINGS.floatingButtonTop;
    return settings;
  }

  /** @returns {Workspaces} */
  function shapeWorkspaces(raw) {
    const out = {};
    if (!isObject(raw)) return out;
    for (const [id, info] of Object.entries(raw)) {
      if (SCOPE_RE.test(id) && id !== GLOBAL && isObject(info)) {
        out[id] = { name: typeof info.name === 'string' ? info.name.slice(0, 120) : '', lastSeen: Number(info.lastSeen) || 0 };
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ settings */

  /** @returns {Promise<Settings>} */
  async function getSettings() {
    const data = await area().get(KEYS.settings);
    return withDefaults(data[KEYS.settings]);
  }

  /** @param {Partial<Settings>} patch @returns {Promise<Settings>} */
  function updateSettings(patch) {
    return withLock(async () => {
      const next = withDefaults({ ...(await getSettings()), ...patch });
      await area().set({ [KEYS.settings]: next });
      return next;
    });
  }

  /* ------------------------------------------------------------------ rules */

  /** @returns {Promise<RulesByScope>} */
  async function getRulesByScope() {
    const data = await area().get(KEYS.rules);
    return shapeRules(data[KEYS.rules]);
  }

  /**
   * Rules that apply to a workspace: global ones first, then the workspace's own.
   * @param {RulesByScope} rulesByScope
   * @param {string|null} teamId
   * @returns {Rule[]}
   */
  function rulesForScope(rulesByScope, teamId) {
    const own = teamId && teamId !== GLOBAL ? rulesByScope[teamId] || [] : [];
    return [...(rulesByScope[GLOBAL] || []), ...own];
  }

  /** @returns {Promise<Rule[]>} */
  async function getRulesForWorkspace(teamId) {
    return rulesForScope(await getRulesByScope(), teamId);
  }

  /** @returns {{rule: Rule, scope: string, index: number}|null} */
  function locate(rulesByScope, id) {
    for (const [scope, list] of Object.entries(rulesByScope)) {
      const index = list.findIndex((rule) => rule.id === id);
      if (index !== -1) return { rule: list[index], scope, index };
    }
    return null;
  }

  async function saveRules(rulesByScope) {
    const clean = {};
    for (const [scope, list] of Object.entries(rulesByScope)) if (list.length) clean[scope] = list;
    await area().set({ [KEYS.rules]: clean });
  }

  /** @param {Partial<Rule>} raw @returns {Promise<Rule>} */
  function addRule(raw) {
    return withLock(async () => {
      const rule = normalizeRule({ ...raw, id: undefined, createdAt: undefined, updatedAt: undefined });
      if (!rule) throw new Error('Regola non valida');
      const rulesByScope = await getRulesByScope();
      (rulesByScope[rule.scope] = rulesByScope[rule.scope] || []).push(rule);
      await saveRules(rulesByScope);
      return rule;
    });
  }

  /** Merges `patch` into the rule, moving it to another scope if needed. @returns {Promise<Rule>} */
  function updateRule(id, patch) {
    return withLock(async () => {
      const rulesByScope = await getRulesByScope();
      const found = locate(rulesByScope, id);
      if (!found) throw new Error('Regola non trovata');
      const next = normalizeRule({ ...found.rule, ...patch, id, createdAt: found.rule.createdAt, updatedAt: Date.now() });
      if (!next) throw new Error('Regola non valida');
      if (next.scope === found.scope) {
        rulesByScope[found.scope][found.index] = next;
      } else {
        rulesByScope[found.scope].splice(found.index, 1);
        (rulesByScope[next.scope] = rulesByScope[next.scope] || []).push(next);
      }
      await saveRules(rulesByScope);
      return next;
    });
  }

  /** @returns {Promise<boolean>} true when a rule was removed */
  function removeRule(id) {
    return withLock(async () => {
      const rulesByScope = await getRulesByScope();
      const found = locate(rulesByScope, id);
      if (!found) return false;
      rulesByScope[found.scope].splice(found.index, 1);
      await saveRules(rulesByScope);
      return true;
    });
  }

  function setRuleEnabled(id, enabled) {
    return updateRule(id, { enabled: !!enabled });
  }

  /* ------------------------------------------------------------------ workspaces */

  /** @returns {Promise<Workspaces>} */
  async function getWorkspaces() {
    const data = await area().get(KEYS.workspaces);
    return shapeWorkspaces(data[KEYS.workspaces]);
  }

  /** Stores the display name of a workspace; writes only when something changed. */
  function rememberWorkspace(teamId, name) {
    if (!teamId || !SCOPE_RE.test(teamId) || teamId === GLOBAL) return Promise.resolve();
    return withLock(async () => {
      const workspaces = await getWorkspaces();
      const current = workspaces[teamId];
      const nextName = (name || current?.name || '').slice(0, 120);
      const today = new Date().toDateString();
      if (current && current.name === nextName && new Date(current.lastSeen).toDateString() === today) return;
      workspaces[teamId] = { name: nextName, lastSeen: Date.now() };
      await area().set({ [KEYS.workspaces]: workspaces });
    });
  }

  /* ------------------------------------------------------------------ backup */

  /** @returns {Promise<ExportedConfig>} */
  async function exportConfig() {
    const [rules, workspaces] = await Promise.all([getRulesByScope(), getWorkspaces()]);
    return {
      format: C.EXPORT_FORMAT,
      version: C.EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      rules,
      workspaces,
    };
  }

  /**
   * Imports an exported configuration (or a plain array of rules).
   * Rules with an id that already exists are replaced; `replace: true` wipes existing rules first.
   * @param {any} data Parsed JSON
   * @param {{replace?: boolean}} [options]
   * @returns {Promise<{imported: number, skipped: number}>}
   */
  function importConfig(data, { replace = false } = {}) {
    /** @type {Array<[any, string|null]>} */
    const incoming = [];
    let workspaces = {};
    if (Array.isArray(data)) {
      for (const raw of data) incoming.push([raw, null]);
    } else if (isObject(data)) {
      if (data.format !== undefined && data.format !== C.EXPORT_FORMAT) throw new Error('Il file non è un backup di Slack UI Tweaker');
      if (Array.isArray(data.rules)) for (const raw of data.rules) incoming.push([raw, null]);
      else if (isObject(data.rules)) {
        for (const [scope, list] of Object.entries(data.rules)) {
          if (Array.isArray(list)) for (const raw of list) incoming.push([raw, scope]);
        }
      } else throw new Error('Nessuna regola trovata nel file');
      workspaces = shapeWorkspaces(data.workspaces);
    } else {
      throw new Error('Formato JSON non riconosciuto');
    }

    return withLock(async () => {
      const rulesByScope = replace ? {} : await getRulesByScope();
      let imported = 0;
      let skipped = 0;
      for (const [raw, scope] of incoming) {
        const rule = normalizeRule(isObject(raw) && scope ? { ...raw, scope } : raw);
        if (!rule) {
          skipped++;
          continue;
        }
        const existing = locate(rulesByScope, rule.id);
        if (existing) rulesByScope[existing.scope].splice(existing.index, 1);
        (rulesByScope[rule.scope] = rulesByScope[rule.scope] || []).push(rule);
        imported++;
      }
      const knownWorkspaces = await getWorkspaces();
      for (const [id, info] of Object.entries(workspaces)) {
        if (!knownWorkspaces[id] || !knownWorkspaces[id].name) knownWorkspaces[id] = info;
      }
      await saveRules(rulesByScope);
      await area().set({ [KEYS.workspaces]: knownWorkspaces });
      return { imported, skipped };
    });
  }

  /* ------------------------------------------------------------------ change feed */

  /**
   * Calls back with the parts of our storage that changed (already shaped).
   * @param {(changes: {settings?: Settings, rules?: RulesByScope, workspaces?: Workspaces}) => void} callback
   * @returns {() => void} unsubscribe
   */
  function onChange(callback) {
    const listener = (changes, areaName) => {
      if (areaName !== 'local') return;
      const payload = {};
      if (changes[KEYS.settings]) payload.settings = withDefaults(changes[KEYS.settings].newValue);
      if (changes[KEYS.rules]) payload.rules = shapeRules(changes[KEYS.rules].newValue);
      if (changes[KEYS.workspaces]) payload.workspaces = shapeWorkspaces(changes[KEYS.workspaces].newValue);
      if (Object.keys(payload).length) callback(payload);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  SUT.storage = Object.freeze({
    DEFAULT_SETTINGS,
    createId,
    normalizeRule,
    getSettings,
    updateSettings,
    getRulesByScope,
    getRulesForWorkspace,
    rulesForScope,
    addRule,
    updateRule,
    removeRule,
    setRuleEnabled,
    getWorkspaces,
    rememberWorkspace,
    exportConfig,
    importConfig,
    onChange,
  });
})(globalThis);
