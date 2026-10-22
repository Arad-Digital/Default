# CLAUDE.md

> This file provides context for AI assistants working with this repository.

## Project Overview

**Repository:** `Arad-Digital/Default`
**Status:** Early stage — contains the **Slack UI Tweaker** Chrome extension

The repository currently hosts one project: `slack-ui-tweaker/`, a Manifest V3 Chrome/Edge extension that lets users restyle Slack Web/PWA (`https://app.slack.com/*`) with a point-and-click inspector. Its user documentation (Italian) is in `slack-ui-tweaker/README.md`.

## Repository Structure

```
/
├── CLAUDE.md                  # AI assistant context (this file)
└── slack-ui-tweaker/          # Unpacked MV3 extension (load this folder in chrome://extensions)
    ├── manifest.json
    ├── background/            # Service worker: relays the Alt+S command to the active tab
    ├── content/               # Content scripts (classic scripts, loaded in manifest order)
    ├── popup/                 # Dashboard (action popup + options page)
    ├── shared/                # constants, DOM helpers, chrome.storage helpers
    ├── icons/                 # icon.svg source + PNG sizes
    └── README.md              # User guide: install, PWA, usage, test plan
```

## Development Setup

### Prerequisites

- Chrome or Edge 102+. No npm dependencies and no build step: the extension ships as plain JS/CSS/HTML.

### Getting Started

```bash
git clone <repository-url>
cd Default
# chrome://extensions → Developer mode → "Load unpacked" → select slack-ui-tweaker/
# then reload any open app.slack.com tab
```

## Common Commands

| Command | Description |
|---------|-------------|
| `git status` | Check working tree status |
| `for f in $(find slack-ui-tweaker -name '*.js'); do node --check "$f"; done` | Syntax check |
| _(none)_ | Build — not needed |
| _(TBD)_ | Automated tests — none committed yet; see the manual test plan in `slack-ui-tweaker/README.md` |
| _(TBD)_ | Lint / Format — no config committed |

## Architecture

### slack-ui-tweaker

- **No bundler / no ES modules**: MV3 content scripts can't be modules, so every file is a classic script that registers itself on `globalThis.SUT` (`SUT.constants`, `SUT.dom`, `SUT.storage`, `SUT.selectorGenerator`, `SUT.styleEngine`, `SUT.domMutations`, `SUT.ui`, `SUT.inspector`). Load order matters and is declared in `manifest.json` → `content_scripts[0].js`. `shared/constants.js` must stay DOM-free (the service worker `importScripts` it).
- **Data flow**: popup/inspector write `chrome.storage.local` (`sutSettings`, `sutRules` grouped by scope `global`/team id, `sutWorkspaces`) → `content.js` listens to `storage.onChanged` → `style-engine.js` rewrites the single `<style id="slack-ui-tweaker-styles">`; `dom-mutations.js` injects ▸/▾ toggles for `collapse` rules.
- **Invariants**: every write goes through `normalizeRule()` (`shared/storage.js`); every rule's CSS goes through `sanitizeCss()` (re-serialized by the browser parser, remote `url()` stripped); in-page UI lives in a Shadow DOM host and is built with `SUT.dom.h()` — never `innerHTML`; nodes injected into Slack's DOM carry `data-sut-ui`, which generated CSS excludes.
- **Performance**: no page listeners while the inspector is off (except one keydown for Alt+S); the body MutationObserver exists only while a collapse rule is active.

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
| `slack-ui-tweaker/manifest.json` | Permissions, content script order, Alt+S command |
| `slack-ui-tweaker/shared/storage.js` | Data model (JSDoc) and all chrome.storage access |
| `slack-ui-tweaker/content/selector-generator.js` | Stable-selector heuristics for Slack's DOM |
| `slack-ui-tweaker/content/style-engine.js` | Rule → CSS generation and sanitization |
| `slack-ui-tweaker/content/inspector.js` | Point-and-click inspector, menu and editor |
| `slack-ui-tweaker/README.md` | User guide (Italian) |

## Notes for AI Assistants

- Always read relevant source files before proposing changes
- Prefer editing existing files over creating new ones
- Run tests and linting after making changes (once configured)
- Keep this CLAUDE.md updated when project structure or conventions change
- Do not over-engineer solutions; match the complexity of the existing codebase
- When in doubt about conventions, follow patterns already established in the code
