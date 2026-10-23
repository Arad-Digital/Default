# CLAUDE.md

> This file provides context for AI assistants working with this repository.

## Project Overview

**Repository:** `Arad-Digital/slack-ui-tweaker` (moved here from `Arad-Digital/Default`)
**Status:** Internal tool, distributed unpacked (Chrome Web Store publishing not decided)

**Slack UI Tweaker** is a Manifest V3 Chrome/Edge extension that lets users restyle Slack Web/PWA (`https://app.slack.com/*`) with a point-and-click inspector. The extension itself lives in `extension/`; the user documentation (Italian) is `README.md`.

## Repository Structure

```
/
├── CLAUDE.md                  # AI assistant context (this file)
├── README.md                  # User guide (Italian): install, PWA, usage, test plan, architecture
└── extension/                 # Unpacked MV3 extension: the folder to load in chrome://extensions or zip
    ├── manifest.json
    ├── background/            # Service worker: relays the Alt+S command to the active tab
    ├── content/               # Content scripts (classic scripts, loaded in manifest order)
    ├── popup/                 # Dashboard (action popup + options page)
    ├── shared/                # constants, DOM helpers, chrome.storage helpers
    └── icons/                 # icon.svg source + PNG sizes
```

Keep `extension/` free of anything Chrome does not need (docs, tests, tooling go at the root).

## Development Setup

### Prerequisites

- Chrome or Edge 102+. No npm dependencies and no build step: the extension ships as plain JS/CSS/HTML.

### Getting Started

```bash
git clone <repository-url>
cd Default
# chrome://extensions → Developer mode → "Load unpacked" → select extension/
# then reload any open app.slack.com tab
```

## Common Commands

| Command | Description |
|---------|-------------|
| `git status` | Check working tree status |
| `find extension -name '*.js' -exec node --check {} \;` | Syntax check |
| _(none)_ | Build — not needed |
| _(TBD)_ | Automated tests — none committed yet; see the manual test plan in `README.md` |
| _(TBD)_ | Lint / Format — no config committed |

## Architecture

### extension/

- **No bundler / no ES modules**: MV3 content scripts can't be modules, so every file is a classic script that registers itself on `globalThis.SUT` (`SUT.constants`, `SUT.dom`, `SUT.storage`, `SUT.selectorGenerator`, `SUT.styleEngine`, `SUT.domMutations`, `SUT.ui`, `SUT.inspector`). Load order matters and is declared in `manifest.json` → `content_scripts[0].js`. `shared/constants.js` must stay DOM-free (the service worker `importScripts` it).
- **Data flow**: popup/inspector write `chrome.storage.local` (`sutSettings`, `sutRules` grouped by scope `global`/team id, `sutWorkspaces`) → `content.js` listens to `storage.onChanged` → `style-engine.js` rewrites the single `<style id="slack-ui-tweaker-styles">`; `dom-mutations.js` injects ▸/▾ toggles for `collapse` rules.
- **Invariants**:
  - every write goes through `normalizeRule()` (`shared/storage.js`); workspaces store only `{ name }` and backups export only workspaces that have rules;
  - every rule's CSS goes through `sanitizeCss()`, which **fails closed**: allowlisted rule types only, declarations that could fetch anything are dropped unless every URL is `data:` (or `#id` in filter/mask/clip-path/marker/fill/stroke). URLs are tokenized/parsed, never regex-matched; same-origin URLs are dropped too. Any new CSS feature must keep that property;
  - in-page UI lives in a Shadow DOM host and is built with `SUT.dom.h()` — never `innerHTML`; nodes injected into Slack's DOM carry `data-sut-ui`, which generated CSS excludes;
  - the extension never reads Slack's `localStorage` (it holds session tokens): the workspace name comes from `document.title`;
  - when `chrome.runtime.id` disappears (extension reloaded/disabled), `content.js` `teardown()` removes rules, toggles, launcher and listeners.
- **Accessibility conventions**: panel controls carry `data-focus-key` so `ui.panel.show()` can restore focus after re-renders; editor fields use `field(text, control, ...descriptions)` (explicit `<label for>`, hints via `aria-describedby`, never interactive content inside the label); keyboard handling for our UI lives in the inspector's window-level `onKeyDown` (listeners inside the shadow root never receive keydown) — see `ui.handleKey()`; forced-colors states use borders/outlines with system colors, not Highlight fills (Chrome paints a Canvas backplate behind text).
- **Performance**: no page listeners while the inspector is off (except one keydown for Alt+S); the body MutationObserver exists only while a collapse rule is active and caps its backlog while the page is hidden; the highlighter batches reads before writes; the selector generator memoizes document queries per public call (`withMemo`).
- **Reference guidance**: the Google Chrome "Modern Web Guidance" plugin (skills `chrome-extensions` and `modern-web-guidance`) is the reference for MV3 and web-platform choices; consult it before adding UI or extension APIs.

## Coding Conventions

### General

- Write clear, self-documenting code
- Keep functions focused and small
- Prefer composition over inheritance
- Follow the principle of least surprise

### Git Workflow

- Use descriptive commit messages explaining **why**, not just what
- Keep commits atomic - one logical change per commit
- Branch naming: `feature/`, `fix/`, `chore/` prefixes recommended

### Code Style

- 2-space indentation, single quotes, semicolons, trailing commas in multi-line literals, lines generally ≤ 140 chars (long CSS strings and regexes excepted).
- Code comments in English; user-facing strings (extension UI, README) in Italian.
- JSDoc typedefs in `shared/storage.js` are the source of truth for the data model.

## Testing

_(To be documented when the testing framework is set up)_

## CI/CD

_(To be documented when CI/CD pipelines are configured)_

## Key Files Reference

| File | Purpose |
|------|---------|
| `CLAUDE.md` | AI assistant context and project guide |
| `README.md` | User guide (Italian) |
| `extension/manifest.json` | Permissions (`storage` + host `app.slack.com`), content script order, Alt+S command |
| `extension/shared/storage.js` | Data model (JSDoc) and all chrome.storage access |
| `extension/content/selector-generator.js` | Stable-selector heuristics for Slack's DOM |
| `extension/content/style-engine.js` | Rule → CSS generation and fail-closed sanitization |
| `extension/content/inspector.js` | Point-and-click inspector, menu and editor |
| `extension/content/ui-shell.js` | Shadow DOM host: highlights, panel, toasts, launcher, keyboard movement |

## Notes for AI Assistants

- Always read relevant source files before proposing changes
- Prefer editing existing files over creating new ones
- Run tests and linting after making changes (once configured)
- Keep this CLAUDE.md updated when project structure or conventions change
- Do not over-engineer solutions; match the complexity of the existing codebase
- When in doubt about conventions, follow patterns already established in the code
