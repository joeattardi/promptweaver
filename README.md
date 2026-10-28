# Promptweaver

A free, local-first desktop app for managing a library of reusable AI prompt templates. Each prompt is a Markdown file with YAML frontmatter that declares a fill-in form. You answer the questions and get a finished prompt on your clipboard.

> **Status:** early development (Phase 1). The desktop app opens a placeholder window, and the `prompt-lang` package (parser, linter, renderer, form model, and editing operations) is complete and tested. The prompt library, fill-in form, quick launcher, and editor come in later phases. There are no packaged installers yet.

## Requirements

- **Node.js 22.12 or newer.** The exact major version is pinned in `.nvmrc`, so with [nvm](https://github.com/nvm-sh/nvm) you can run `nvm use`.
- **npm 10.9 or newer** (it ships with Node 22). This repository uses npm workspaces. Don't use pnpm or yarn.
- macOS, Windows, or Linux. Development so far has been on macOS.

## Getting started

```sh
git clone <repo-url> promptweaver
cd promptweaver
nvm use        # optional, picks up .nvmrc
npm install    # also downloads the Electron binary
npm run dev    # launches the desktop app with hot reload
```

`npm run dev` starts the Vite dev server and opens the main window. Changes to renderer code reload in place, and changes to the main process or preload script restart the app.

For a clean, reproducible install (in CI, for example), use `npm ci` instead of `npm install`.

## Building

```sh
npm run build                  # production bundle in apps/desktop/out
npm run start -w apps/desktop  # run the production bundle locally
```

`npm run build` compiles the main process, preload script, and both renderer windows (main window and quick launcher) into `apps/desktop/out`. It doesn't produce an installer yet; packaging is planned for a later phase.

## Testing and checks

Run these from the repository root:

| Command                   | What it does                                      |
| ------------------------- | ------------------------------------------------- |
| `npm test`                | Runs every test once (Vitest, all workspaces)     |
| `npm run test:watch`      | Runs tests in watch mode                          |
| `npm test -w prompt-lang` | Runs only the `prompt-lang` tests                 |
| `npm run typecheck`       | Type-checks every workspace with `tsc`            |
| `npm run lint`            | Runs ESLint, then checks formatting with Prettier |
| `npm run format`          | Formats files with Prettier                       |

Run all three before committing:

```sh
npm run typecheck && npm run lint && npm test
```

## Repository layout

```
apps/
  desktop/              Electron app (electron-vite, React, Tailwind)
    src/main/           main process: windows, IPC handlers, security policy
    src/preload/        typed API exposed to both windows as window.api
    src/renderer/       the two windows: index.html (main) and launcher.html
    src/shared/         IPC contract shared by main, preload, and renderers
packages/
  prompt-lang/          the prompt file format: parse, lint, render, form model, edits
    src/fixtures/       example prompts used by the golden-output tests
```

`packages/prompt-lang` is plain TypeScript with no Electron, React, or Node dependencies, so it can be reused by a future CLI or editor extension. Lint rules enforce this.

## Troubleshooting

**`npm run dev` fails with `Cannot read properties of undefined (reading 'isPackaged')`.**
Your shell has `ELECTRON_RUN_AS_NODE` set, which makes Electron run as plain Node. Some editor-integrated terminals and tools set it. Run:

```sh
env -u ELECTRON_RUN_AS_NODE npm run dev
```

**Electron fails to start after install, or the binary is missing.**
The Electron binary downloads in the desktop app's `postinstall` step. If that was skipped (for example by `npm install --ignore-scripts`), run it again:

```sh
npm run postinstall -w apps/desktop
```
