/**
 * Slack UI Tweaker — shared constants.
 *
 * Every script of the extension is a classic script (MV3 content scripts cannot be ES modules),
 * so the modules share a single namespace object: `globalThis.SUT`.
 * In content scripts that namespace lives in the extension's isolated world: Slack never sees it.
 *
 * This file must stay DOM-free: the background service worker loads it with importScripts().
 */
(function (root) {
  'use strict';

  const SUT = (root.SUT = root.SUT || {});

  /** Actions offered by the inspector. `icon` refers to SUT.dom.ICONS. */
  const ACTIONS = Object.freeze({
    hide: {
      label: 'Nascondi',
      short: 'Nascosto',
      icon: 'eyeOff',
      hint: "Rimuove l'elemento (display: none)",
    },
    hover: {
      label: 'Mostra solo in hover',
      short: 'Hover',
      icon: 'pointer',
      hint: 'Invisibile finché non passi sopra il contenitore',
    },
    fade: {
      label: 'Dissolvenza',
      short: 'Sfumato',
      icon: 'droplet',
      hint: 'Opacità al 20%, piena in hover',
    },
    compact: {
      label: 'Compatta',
      short: 'Compatto',
      icon: 'compress',
      hint: 'Dimezza padding e margini',
    },
    collapse: {
      label: 'Collassabile con toggle',
      short: 'Toggle',
      icon: 'chevrons',
      hint: 'Aggiunge un pulsante ▸/▾ per aprire e chiudere',
    },
    custom: {
      label: 'CSS personalizzato',
      short: 'CSS',
      icon: 'code',
      hint: 'Regola CSS scritta a mano',
    },
  });

  SUT.constants = Object.freeze({
    STYLE_ELEMENT_ID: 'slack-ui-tweaker-styles',
    PREVIEW_STYLE_ELEMENT_ID: 'slack-ui-tweaker-preview',
    CURSOR_STYLE_ELEMENT_ID: 'slack-ui-tweaker-cursor',
    UI_HOST_ID: 'slack-ui-tweaker-root',

    /** Set on every node the extension injects into Slack's DOM (UI host, collapse toggles). */
    UI_ATTR: 'data-sut-ui',
    /** Links an injected collapse toggle to the rule that created it. */
    RULE_ATTR: 'data-sut-rule',

    GLOBAL_SCOPE: 'global',
    STORAGE_KEYS: Object.freeze({
      settings: 'sutSettings',
      rules: 'sutRules',
      workspaces: 'sutWorkspaces',
    }),

    EXPORT_FORMAT: 'slack-ui-tweaker',
    EXPORT_VERSION: 1,

    COMMAND_TOGGLE_INSPECTOR: 'toggle-inspector',
    MSG: Object.freeze({
      GET_CONTEXT: 'SUT_GET_CONTEXT',
      TOGGLE_INSPECTOR: 'SUT_TOGGLE_INSPECTOR',
      START_INSPECTOR: 'SUT_START_INSPECTOR',
      EDIT_RULE: 'SUT_EDIT_RULE',
      FLASH_RULE: 'SUT_FLASH_RULE',
    }),

    ACTIONS,
    /** Actions listed in the inspector menu, in display order ('custom' comes from the editor). */
    ACTION_ORDER: Object.freeze(['hide', 'hover', 'fade', 'compact', 'collapse']),

    /** Ancestors that reveal a "hover" rule in 'container' mode: message rows, list and tree items. */
    HOVER_CONTAINERS: Object.freeze([
      '[data-qa="message_container"]',
      '[data-qa="virtual-list-item"]',
      '[role="listitem"]',
      '[role="treeitem"]',
    ]),
  });
})(globalThis);
