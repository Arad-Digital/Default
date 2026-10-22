/**
 * Slack UI Tweaker — content script entrypoint.
 *
 * Runs at document_start on https://app.slack.com/* (browser tab or installed PWA window):
 * 1. injects the stylesheet immediately, then fills it as soon as the rules are read from storage;
 * 2. keeps rules in sync with chrome.storage (edits from the popup or from other tabs are live);
 * 3. follows the current workspace (team id in /client/T…/…) across SPA navigation;
 * 4. answers the popup and the keyboard command (see background/service-worker.js).
 */
(function () {
  'use strict';

  const SUT = globalThis.SUT;
  if (!SUT || SUT.booted) return;
  SUT.booted = true;

  const C = SUT.constants;
  const storage = SUT.storage;
  const engine = SUT.styleEngine;
  const mutations = SUT.domMutations;
  const inspector = SUT.inspector;
  const ui = SUT.ui;
  const gen = SUT.selectorGenerator;

  const WORKSPACE_POLL_MS = 1500;
  const NAME_RETRY_MS = 4000;
  const NAME_RETRIES = 3;

  const state = {
    /** @type {import('../shared/storage.js').Settings} */
    settings: { ...storage.DEFAULT_SETTINGS },
    /** @type {import('../shared/storage.js').RulesByScope} */
    rulesByScope: {},
    teamId: detectTeamId(),
    teamName: '',
  };

  engine.mount();
  mutations.init({ onToggle: toggleCollapse });
  inspector.init({
    getTeam: () => ({ id: state.teamId, name: state.teamName }),
    isEnabled: () => state.settings.enabled,
    enable: () => storage.updateSettings({ enabled: true }).catch(warn),
    addRule: (rule) => storage.addRule(rule),
    updateRule: (id, patch) => storage.updateRule(id, patch),
    removeRule: (id) => storage.removeRule(id),
    onActiveChange: (active) => ui.setFabActive(active),
  });
  chrome.runtime.onMessage.addListener(onMessage);
  storage.onChange(onStorageChange);
  watchWorkspace();
  boot();

  async function boot() {
    try {
      const [settings, rulesByScope] = await Promise.all([storage.getSettings(), storage.getRulesByScope()]);
      state.settings = settings;
      state.rulesByScope = rulesByScope;
    } catch (error) {
      warn(error);
    }
    applyRules();
    onDomReady(() => {
      syncFloatingButton();
      updateWorkspaceName(NAME_RETRIES);
    });
  }

  /* ------------------------------------------------------------------ rules */

  function activeRules() {
    return state.settings.enabled ? storage.rulesForScope(state.rulesByScope, state.teamId) : [];
  }

  function applyRules() {
    const rules = activeRules();
    engine.render(rules);
    mutations.setRules(rules);
  }

  function findRule(id) {
    for (const list of Object.values(state.rulesByScope)) {
      const rule = list.find((r) => r.id === id);
      if (rule) return rule;
    }
    return null;
  }

  /** Click on a ▸/▾ toggle: flip the rule state locally (instant) and persist it. */
  async function toggleCollapse(ruleId) {
    const rule = findRule(ruleId);
    if (!rule) return;
    const options = { ...rule.options, collapsed: rule.options?.collapsed === false };
    rule.options = options;
    applyRules();
    try {
      await storage.updateRule(ruleId, { options });
    } catch (error) {
      warn(error);
    }
  }

  function onStorageChange({ settings, rules }) {
    if (settings) {
      const wasEnabled = state.settings.enabled;
      state.settings = settings;
      if (wasEnabled && !settings.enabled) inspector.deactivate();
      syncFloatingButton();
    }
    if (rules) state.rulesByScope = rules;
    if (settings || rules) applyRules();
  }

  /* ------------------------------------------------------------------ workspace */

  /** Team (T…) or enterprise (E…) id from https://app.slack.com/client/T0123ABCD/C0123ABCD */
  function detectTeamId() {
    const match = /^\/client\/([A-Z0-9]{5,32})(?:\/|$)/.exec(location.pathname);
    return match ? match[1] : null;
  }

  function readTeamName(teamId) {
    if (!teamId) return '';
    try {
      // Slack keeps the list of signed-in workspaces in its own localStorage (same origin).
      const config = JSON.parse(localStorage.getItem('localConfig_v2') || 'null');
      const name = config && config.teams && config.teams[teamId] && config.teams[teamId].name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    } catch {
      // Optional source: ignore.
    }
    // Title fallback: "general (Channel) - Acme Inc - Slack"
    const parts = document.title.split(' - ').map((part) => part.trim()).filter(Boolean);
    return parts.length >= 3 && /slack/i.test(parts[parts.length - 1]) ? parts[parts.length - 2] : '';
  }

  function updateWorkspaceName(retries) {
    const teamId = state.teamId;
    if (!teamId) return;
    const name = readTeamName(teamId);
    if (name) state.teamName = name;
    storage.rememberWorkspace(teamId, name).catch(warn);
    if (!name && retries > 0) {
      setTimeout(() => {
        if (state.teamId === teamId) updateWorkspaceName(retries - 1);
      }, NAME_RETRY_MS);
    }
  }

  /** Slack switches workspace without reloading: watch the URL (cheap string comparison). */
  function watchWorkspace() {
    const check = () => {
      const teamId = detectTeamId();
      if (teamId === state.teamId) return;
      state.teamId = teamId;
      state.teamName = '';
      applyRules();
      updateWorkspaceName(NAME_RETRIES);
    };
    window.addEventListener('popstate', check);
    if (window.navigation) window.navigation.addEventListener('navigatesuccess', check);
    setInterval(check, WORKSPACE_POLL_MS);
  }

  /* ------------------------------------------------------------------ floating button */

  function syncFloatingButton() {
    if (!document.body) return;
    const { enabled, showFloatingButton, floatingButtonTop } = state.settings;
    ui.setFab({
      visible: enabled && showFloatingButton,
      top: floatingButtonTop,
      active: inspector.isActive(),
      onClick: () => inspector.toggle('fab'),
      onMove: (top) => storage.updateSettings({ floatingButtonTop: top }).catch(warn),
    });
  }

  /* ------------------------------------------------------------------ messages */

  function context() {
    const matchCounts = {};
    for (const rule of storage.rulesForScope(state.rulesByScope, state.teamId)) matchCounts[rule.id] = gen.count(rule.selector);
    return {
      ok: true,
      teamId: state.teamId,
      teamName: state.teamName,
      enabled: state.settings.enabled,
      inspectorActive: inspector.isActive(),
      matchCounts,
    };
  }

  function onMessage(message, sender, sendResponse) {
    if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false;
    switch (message.type) {
      case C.MSG.GET_CONTEXT:
        sendResponse(context());
        break;
      case C.MSG.TOGGLE_INSPECTOR:
        sendResponse({ ok: true, active: inspector.toggle('command') });
        break;
      case C.MSG.START_INSPECTOR:
        sendResponse({ ok: true, active: inspector.activate() });
        break;
      case C.MSG.EDIT_RULE: {
        const rule = findRule(message.ruleId);
        sendResponse({ ok: !!rule && inspector.editRule(rule) });
        break;
      }
      case C.MSG.FLASH_RULE: {
        const rule = findRule(message.ruleId);
        sendResponse({ ok: !!rule, count: rule ? inspector.flashRule(rule) : 0 });
        break;
      }
      default:
        return false;
    }
    return false;
  }

  /* ------------------------------------------------------------------ helpers */

  function onDomReady(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  function warn(error) {
    console.warn('[Slack UI Tweaker]', error);
  }
})();
