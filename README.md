# Promptweaver

A free, local-first desktop app for managing a library of reusable AI prompt templates. Each prompt is a Markdown file with YAML frontmatter that declares a fill-in form. You answer the questions and get a finished prompt on your clipboard.

> **Status:** early development (Phase 3). You can pick a library folder, browse and search your prompts, fill in a prompt's form, see a live preview, and copy the finished prompt to your clipboard. Edits made to the files on disk show up immediately. The quick launcher and the editor aren't built yet. The `prompt-lang` package (parser, linter, renderer, form model, and editing operations) is complete and tested. There are no packaged installers yet.

## Requirements

- **Node.js 22.22 or newer.** The exact major version is pinned in `.nvmrc`, so with [nvm](https://github.com/nvm-sh/nvm) you can run `nvm use`.
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

## Your prompt library

On first launch the app shows a welcome screen. Nothing is created on disk until you choose:

- **Create a library with starter prompts** makes `~/Documents/Promptweaver` and fills it with a few examples. If that folder already has prompts, it's used as it is and nothing is added.
- **Choose an existing folder…** uses any folder of Markdown files. Nothing in it is changed.

Each `*.md` file is one prompt, and subfolders act as categories. Files and folders starting with a dot are ignored, and files must be UTF-8 text under 1 MB. Edit the files in any editor: the app notices changes, additions, renames and deletions straight away. Files it can't load are listed in the app instead of silently skipped.

The folder you chose is saved in `settings.json` in the app's data folder (on macOS, `~/Library/Application Support/Promptweaver`).

### Using a prompt

Select a prompt and the **Fill in** tab shows its questions beside a live preview of the finished prompt. Press **Copy prompt** (or Cmd/Ctrl+Enter from anywhere in the form) to put the result on your clipboard. Enter in a single-line field also copies. If a required answer is missing, focus moves to it instead. The **Details** tab shows the prompt's aliases, tags, problems and template.

- A choice between a few options is a list: Up/Down move through it, the number keys 1-9 choose directly, and typing a few letters jumps to a match. Longer lists are a drop-down.
- In a multiple-choice list, Up/Down move and Space ticks.
- Fields marked `from: clipboard` start with whatever is on your clipboard when the form opens. If you copy something else later, **Paste from clipboard** next to the field refills it.
- The app remembers your answers for each prompt and fills them in next time. Fields filled from the clipboard are not remembered, so pasted text isn't kept on disk. The answers are stored in `state.json` in the app's data folder, never in your prompt files.

### Trying the app with a throwaway library

To see first run, or to test against a scratch folder, without touching your real settings, run the built app with its own data folder:

```sh
npm run build
npx electron apps/desktop --user-data-dir=/tmp/promptweaver-try
```

(If that fails with the `isPackaged` error described under Troubleshooting, prefix it with `env -u ELECTRON_RUN_AS_NODE`.)

## Building

```sh
npm run build                  # production bundle in apps/desktop/out
npm run start -w apps/desktop  # run the production bundle locally
```

`npm run build` compiles the main process, preload script, and both renderer windows (main window and quick launcher) into `apps/desktop/out`. It doesn't produce an installer yet; packaging is planned for a later phase.

## Testing and checks

Run these from the repository root:

| Command                   | What it does                                                           |
| ------------------------- | ---------------------------------------------------------------------- |
| `npm test`                | Runs every unit and component test once (Vitest, all workspaces)       |
| `npm run test:watch`      | Runs those tests in watch mode                                         |
| `npm test -w prompt-lang` | Runs only the `prompt-lang` tests                                      |
| `npm run test:e2e`        | Builds the app, then runs the end-to-end tests (Playwright) against it |
| `npm run typecheck`       | Type-checks every workspace with `tsc`                                 |
| `npm run lint`            | Runs ESLint, then checks formatting with Prettier                      |
| `npm run format`          | Formats files with Prettier                                            |

There are three layers of tests:

- **Unit tests** (`*.test.ts`, next to the code) cover `prompt-lang`, the search index and the main process: the library, settings, state and copy service.
- **Component tests** (`*.test.tsx` under `apps/desktop/src/renderer`) render the React UI in jsdom with Testing Library, against a fake `window.api`. They cover the form's keyboard behaviour, validation, the live preview, copying, and the main window's tabs, list and search. Shared helpers are in `src/renderer/src/test/`.
- **End-to-end tests** (`apps/desktop/e2e/*.spec.ts`) launch the real built app with Playwright, against a throwaway data folder and a copy of the fixture library in `e2e/fixtures/`. Inside the app the clipboard is replaced by an in-memory one, so the tests never read or overwrite your real clipboard. Run `npm run build` first, or use `npm run test:e2e`, which does both. Failure screenshots and traces go to `apps/desktop/test-results/`.

A few library tests use the real file watcher and wait for events to arrive, so the full run takes a few seconds longer than a pure unit run.

Run these before committing:

```sh
npm run typecheck && npm run lint && npm test && npm run test:e2e
```

## Repository layout

```
apps/
  desktop/              Electron app (electron-vite, React, Tailwind)
    src/main/           main process: windows, IPC handlers, security policy, settings
      library/          reads, parses and watches the library folder
      search/           the SearchIndex interface and its MiniSearch implementation
    src/preload/        typed API exposed to both windows as window.api
    src/renderer/       the two windows: index.html (main) and launcher.html
      src/library/      the library browser (main window)
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
