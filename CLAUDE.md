# Promptweaver

A free, local-first desktop app for managing a library of reusable AI prompt templates. You browse your library, pick a prompt, fill in a "Mad Libs" style form (text fields, dropdowns, multi-selects, toggles), and the app produces a complete, ready-to-paste prompt.

The product name is Promptweaver (domain: promptweaver.app). Keep it in as few places as possible (`package.json` name and `productName`, window title) so renaming stays trivial. Don't bake it into file formats, IPC channel names, or identifiers in `prompt-lang`. Note that an unrelated Python library named `promptweaver` exists on PyPI, so avoid publishing anything under that name to package registries, and check the GitHub repo name for collisions.

## Goals and non-goals

**Goals (v1)**
- **Headline feature: the quick launcher.** A global hotkey summons a lightweight popup where you find a prompt, answer its questions, and have the finished prompt copied to your clipboard, in a few seconds, without touching the mouse. The main app is the home base for managing and authoring the library, and the launcher is how the library gets used all day. Design every phase with the launcher in mind. See "Quick launcher" below.
- Plain files: every prompt is a Markdown file with YAML frontmatter in a user-chosen folder. Portable, hand-editable, Git/Dropbox friendly.
- Authoring that doesn't require memorizing syntax: chips, completion, hover help, lint with quick fixes, "make field from selection".
- Free and local. No accounts, no network calls, no telemetry.

**Non-goals (v1). Do not build these without asking.**
- SQLite or any database. Files are the source of truth. Search uses an in-memory index (MiniSearch) built at startup, hidden behind the `SearchIndex` interface (see "Search"). Conditions for revisiting this decision are listed there.
- AI-assisted authoring or any network/API-key feature.
- Inline field shorthand like `{{language: TypeScript | Python}}`. There is exactly one way to define a field: the frontmatter `fields` map.
- Includes/partials (`{{> shared/snippet}}`), loops, filters, or arbitrary expressions in templates. The `{{>` syntax is reserved so includes can be added later without breaking existing files. Until then it's a lint error.
- Sync, accounts, sharing, billing.
- Auto-pasting into the previously focused app (needs OS accessibility permissions). v1 copies to the clipboard only.

## Tech stack

- Frontend: React + Vite + Tailwind CSS, TypeScript (strict)
- Electron, using electron-vite (the Vite integration for Electron) so the main, preload, and renderer builds all run on Vite
- Zustand for state, Zod for validating frontmatter
- `yaml` library (Document API) for frontmatter. Do NOT use gray-matter's stringify: it destroys comments and key order. Split frontmatter from the body ourselves.
- CodeMirror 6 for the prompt editor (later phase)
- chokidar for watching the library folder (later phase)
- Vitest for tests
- npm (with npm workspaces). Do not use pnpm or yarn.

Keep dependencies minimal. Ask before adding anything not listed here.

Check current stable versions and official docs for Electron, electron-vite, Vite, Tailwind CSS, and Vitest before configuring them. Don't rely on remembered setup steps, because config formats change between major versions (Tailwind especially, including how it integrates with Vite). Pin Node with `.nvmrc` and the `engines` field (node and npm). Commit `package-lock.json`, and use `npm ci` in any automated or clean-install context.

## Repository layout

```
/
  CLAUDE.md
  package.json              (npm workspaces root: "workspaces": ["apps/*", "packages/*"])
  package-lock.json
  apps/
    desktop/                (electron-vite app: main, preload, renderer)
  packages/
    prompt-lang/            (pure TypeScript: no Electron, no React, no Node APIs)
```

`packages/prompt-lang` is the core of the product. It must stay pure and framework-free so it can be reused later (CLI, VS Code extension, web preview) and tested exhaustively.

## Prompt file format (format: 1)

The frontmatter declares the form. The body is plain text with holes in it.

```markdown
---
title: Code Review
description: Review a code change for bugs, readability, and risk
tags: [code, review]
aliases: [cr, review]
format: 1
fields:
  language: { type: select, options: [TypeScript, Python, Go, Rust] }
  focus:
    type: multiselect
    options: [Bugs, Performance, Readability, Security, Tests]
    default: [Bugs, Readability]
  tone:
    type: select
    options:
      Gentle: Be encouraging and suggest improvements diplomatically.
      Blunt: Be direct. Skip praise and list problems in priority order.
  context: { type: textarea, help: What does this change do? }
  code: { type: textarea, required: true, from: clipboard }
---
You are a senior {{language}} engineer reviewing a pull request.

{{if focus}}
Focus on: {{focus}}.
{{end}}
{{tone}}

{{if context}}
## Context
{{context}}
{{end}}

## Code
{{code}}

{{if focus has Security}}
Flag anything that touches user input, auth, or secrets.
{{end}}
```

### Frontmatter

- `title` (required), `description`, `tags` (string array), `aliases` (string array of short codes, for example `[cr, review]`, used by the launcher's search), `format` (number, currently `1`), `fields`.
- Aliases should be short, lowercase, and unique across the library. Duplicate aliases within one file are a lint warning. Cross-file collisions are detected by the library index in the main process and surfaced as a warning in the UI (not by `prompt-lang`, which only sees one file).
- The prompt id is the file name without extension. Do not store an `id` in frontmatter.
- `fields` is a **map keyed by field id** (not a list). Order of keys = order of fields in the form.
- Field ids: letters, digits, underscore, starting with a letter. Case-sensitive.

### Field definition

Common keys: `type`, `label`, `help`, `required`, `default`.

| type | extra keys | value | default |
|---|---|---|---|
| `text` | `from: clipboard` | string | `""` |
| `textarea` | `from: clipboard` | string | `""` |
| `select` | `options` | string | first option unless `required` and no default, in which case unset |
| `multiselect` | `options`, `join` (default `", "`) | string[] | `[]` |
| `toggle` | | boolean | `false` |
| `number` | `min`, `max` | number | unset |

- `label` defaults to a humanized id (`code_review` becomes "Code review"). Only write `label:` to override.
- `options` is either an array of strings, or a **map of label to inserted text**. For a string array, label and value are the same.
- With a label-to-value map, the **form shows the label** and the **placeholder renders the value**. Conditions compare against the **label** (`{{if tone is Blunt}}`).
- Use `from: clipboard` only on `text`/`textarea`. It pre-fills the field from the clipboard when the form opens.
- A toggle used directly as a placeholder renders `yes` or `no`. (Revisit if this feels wrong. Toggles are mainly for conditionals.)

### Body syntax

- Placeholder: `{{id}}`
- Conditionals: `{{if id}}`, `{{if id is Label}}`, `{{if id has Label}}`, `{{else}}`, `{{end}}`
  - `{{if id}}` is true when the value is non-empty (string with non-whitespace, non-empty multiselect, toggle on, number set).
  - `is` is for `select` (and text equality). `has` is for `multiselect`.
  - Everything after the operator up to `}}` is the value, trimmed. No quoting.
  - Nesting is allowed up to 3 levels deep. Beyond that, lint error.
- Escape: `\{{` renders a literal `{{`.
- **Single-pass rendering.** Substituted values are never re-parsed. A user pasting code containing `{{` must come through untouched.
- **Standalone tag lines:** a line containing only a block tag (`{{if ...}}`, `{{else}}`, `{{end}}`) and optional whitespace is removed entirely, including its newline, so conditionals don't leave blank lines.
- **Undeclared placeholders** (`{{topic}}` with no field) become an implicit required `text` field, appended after declared fields in order of first appearance. This lets `Summarize {{topic}}` work with no frontmatter. Lint reports it as an info-level diagnostic with a quick fix "Declare field".
- **Built-in variables.** These reserved names resolve automatically with no field and no question: `{{date}}` (local date, ISO `YYYY-MM-DD`), `{{time}}` (local `HH:mm`), `{{datetime}}` (both), and `{{clipboard}}` (the clipboard text captured when the launcher was summoned). They work in conditions too (`{{if clipboard}}`). They never appear in `formFor`, they take precedence over implicit fields, and declaring a field with a reserved id is a lint error. `{{clipboard}}` is different from a field with `from: clipboard`: the field is a question that starts pre-filled and can be edited, while the built-in is inserted as-is with no question.
- **Reserved include syntax.** `{{> name}}` is reserved for future includes. The parser recognizes it as its own node (not a placeholder), and lint reports "Includes are not supported yet".

## `prompt-lang` public API

```ts
parse(text: string): ParsedPrompt
// ParsedPrompt: { frontmatter (yaml Document + typed fields), body AST, diagnostics from parsing }
// Every AST node and field carries source ranges (character offsets into the full file text).

lint(parsed: ParsedPrompt): Diagnostic[]
// Diagnostic: { severity, code, message, range, fixes?: QuickFix[] }

render(parsed: ParsedPrompt, values: Values, context?: RenderContext): string
// Pure. Applies defaults for missing values.
// RenderContext = { now: Date; clipboard: string } is injected by the caller (never read inside
// prompt-lang) so rendering stays deterministic and testable. Supplies the built-in variables.

formFor(parsed: ParsedPrompt): FormModel
// The ordered list of questions to ask: declared fields in frontmatter order, then implicit fields
// for undeclared placeholders. Each entry has its effective label, type, options ({label, value}[]),
// default, required flag, help text, and `from` source. This is the single input to every form UI
// (main window and launcher), so neither UI re-derives field logic.

validateValues(parsed: ParsedPrompt, values: Values): ValueIssue[]
// Required fields missing, number out of range, select value not in options. Empty array means
// the prompt can be rendered and copied. Used to gate the launcher's "copy" action.

describe(parsed: ParsedPrompt, offset: number): CursorInfo
// What is under/around the cursor: placeholder, tag, frontmatter field, etc. Used for hover and completion.

edits.*  // each returns TextChange[] ({ from, to, insert }) against the full file text
// makeField(selection range, id)  - replace selected text with {{id}}, add field with selection as default
// renameField(id, newId)          - frontmatter key + every {{id}} / {{if id ...}} in one change set
// removeField(id)
// reorderFields(ids)
// updateField(id, patch)          - preserves YAML comments and key order
// wrapIf(range, condition)        - inserts {{if ...}} / {{end}} around a range
```

Edits operate on text and return text changes. The UI never keeps a second model of the prompt. The editor holds the file text, and everything else derives from `parse(text)`.

### Lint rules (initial set)

Errors: unclosed `{{if}}`; stray `{{else}}`/`{{end}}`; `has` on a non-multiselect; `is` value not among a select's options; unknown field type; invalid frontmatter shape (Zod); duplicate field ids; nesting deeper than 3; field id that collides with a built-in variable; include syntax (`{{>`) used before it's supported.
Warnings: declared field never used in the body; option label collisions; duplicate aliases within the file.
Info: undeclared placeholder (quick fix: declare it).

Lint and render must share the same parser so that what the editor flags matches what rendering does.

## Product behavior decisions already made

- **Chips by default, with a toggle to show raw braces.** `{{language}}` renders in the editor as a colored pill by field type. Clicking opens a popover to edit that field.
- **Fields panel** (sidebar) is the friendly alternative to editing YAML. Drag to reorder (this sets form order). Frontmatter is folded by default with a "Source" toggle.
- **Make field from selection** is the signature authoring feature.
- Autocomplete after `{{` (existing fields + "New field..."), after `{{if` (fields, then operators valid for that field type, then that field's options). Hover help on placeholders and keywords. Lint squiggles with quick fixes.
- Library folder is user-chosen and stored in app settings. Prompts are `*.md` files, subfolders allowed (they act as categories).

## Search

Search lives in the main process behind a small interface, so the engine can be swapped later without touching anything else.

```ts
interface IndexedPrompt {
  id: string;            // path relative to the library folder
  title: string;
  aliases: string[];
  tags: string[];
  description: string;
  body: string;          // template text, used for body search
}

interface SearchResult { id: string; score: number; }

interface SearchIndex {
  index(prompts: IndexedPrompt[]): void;   // (re)build from scratch
  update(prompt: IndexedPrompt): void;     // add or replace one prompt
  remove(id: string): void;
  search(query: string, opts?: { limit?: number }): SearchResult[];
}
```

- The v1 implementation uses MiniSearch: prefix matching, light typo tolerance, and field weights (aliases, then title, then tags, then description, then body).
- An exact alias match must always rank first. Handle it as a direct alias lookup before fuzzy results, not through score tuning.
- The index is built from the parsed library at startup and updated incrementally from the file watcher.
- Favorites and recents ranking for an empty query is not the index's job. That lives in app state.
- **Nothing outside the implementation file may import MiniSearch.** Everything else depends on `SearchIndex`.
- Write a shared contract test suite that any `SearchIndex` implementation must pass (prefix match, typo tolerance, alias-first, update, remove, empty query, unicode). A future implementation then drops in with the same tests.

**Revisit SQLite (FTS5) only if one of these becomes true:**
- Libraries routinely exceed roughly 10,000 prompts.
- Measured search latency exceeds about 20 ms per keystroke on a realistic library.
- We need phrase queries or ranking that MiniSearch can't provide.
- Usage analytics or history features would clearly benefit from real queries.
- In-memory index size becomes a real memory problem.

If we do switch, the native module has to be rebuilt against Electron's Node version and affects packaging and code signing. Before adding `better-sqlite3`, check whether the Node version bundled with our Electron exposes a built-in SQLite module reliably. Verify it, don't assume.

## Quick launcher (headline feature)

A Spotlight/Raycast-style popup, summoned by a global hotkey from any app. This is the feature people will use dozens of times a day, so speed and keyboard flow matter more than visual flourish.

**Targets:** popup visible with the search box focused in under ~100 ms after the hotkey. Hotkey to prompt on the clipboard in about 5 seconds for a typical prompt.

### Flow

1. **Hotkey.** The clipboard is read at the moment of the hotkey press (before our window takes focus) so `from: clipboard` fields can be pre-filled with what the user just copied.
2. **Find.** A single search box, focused. Fuzzy search over title, aliases, tags, and description. An exact alias match always ranks first, so typing `cr` then Enter jumps straight to the prompt with `aliases: [cr]` (muscle-memory path). With an empty query, show favorites and recently used first, plus a "New prompt from clipboard" action. Up/Down to move, Enter to select. Results show title plus a one-line description.
3. **Answer.** The form replaces the results in the same window. It shows only the questions (the model comes from `formFor`), first field focused, defaults and last-used values already filled. Fields appear in frontmatter order.
4. **Copy.** Submit renders the prompt (`render`), writes it to the clipboard, flashes a brief "Copied" confirmation, then hides the window so focus returns to the app the user came from.
5. If a prompt has no questions, Enter on it copies immediately, skipping step 3.

### Keyboard map (everything reachable without the mouse; the mouse also works)

- Search: type to filter, Up/Down to move, Enter to select, Esc to close.
- Form: Tab / Shift+Tab between fields. `select`: Up/Down or type-ahead, with number keys 1-9 choosing options directly. `multiselect`: Up/Down to move, Space to toggle. `toggle`: Space. `textarea`: Enter inserts a newline.
- Submit: Cmd/Ctrl+Enter from anywhere in the form (Enter submits from single-line fields). If required fields are empty, focus the first missing one and highlight it instead of copying.
- Esc steps back one level: form returns to search, search closes the window.
- Optional preview: a key (for example Cmd/Ctrl+P) toggles a live preview of the rendered prompt below the form. Hidden by default to keep the window small.
- Optional: Cmd/Ctrl+E opens the selected prompt in the main window's editor.

### Capture from clipboard

Most prompts start life as something that worked once, so capturing one must take seconds. In the launcher, the "New prompt from clipboard" action (also in the tray menu and main window, and reachable by typing "new") does this:

1. Creates a new `.md` file in the library whose body is the clipboard text, with a title derived from the first line (truncated) or "Untitled prompt", no fields, and a unique slugified file name.
2. Hides the launcher, brings the main window forward, and opens the new prompt in the editor, ready to turn pieces into fields with "Make field from selection". Until the editor exists (Phase 5), open it selected in the library view instead.
3. If the clipboard is empty or not text, show a short message instead of creating a file.

### Window behavior

- Frameless, always on top, roughly 640 px wide, centered on the display containing the cursor, with rounded corners. Not shown in the dock/taskbar or window switchers. On macOS, use vibrancy if it looks good and show over full-screen apps.
- Hides on blur and on Esc. Never quits the app.
- The window is **created once at startup, hidden, and shown/hidden on demand**. Do not create and destroy it per invocation. Reset its state (back to the search step) on each show.
- The app keeps running in the background with a tray/menu-bar icon (open library, settings, quit). Offer a "launch at login" setting.
- The hotkey is user-configurable in settings with a key-recorder control. If registration fails (already in use), tell the user and let them pick another. Avoid defaults that clash with common shortcuts (Cmd+Space, Alt+Space, Cmd/Ctrl+Shift+P).

### Architecture requirements

- The **main process owns the library index** (parsed prompts plus the in-memory search index). Both windows get their data over IPC, and the launcher never reads the filesystem itself. This keeps show-time instant and results consistent when files change.
- The launcher is a second renderer entry in electron-vite and reuses the same React form components and `prompt-lang` functions as the main window. Build the fill-in form once, as a shared component driven by `formFor`.
- Last-used values and recents/favorites are stored in a small settings/state JSON in the app data directory, not in the prompt files.
- Copy happens in the main process (Electron `clipboard`) so it works regardless of renderer focus.

## Electron conventions

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where possible.
- All filesystem access happens in the main process. The renderer talks to it through a small, typed IPC API exposed via the preload script. No `ipcRenderer` leaking into renderer code.
- Validate IPC inputs in main.
- The app makes no network requests and loads no remote content. Set a strict Content Security Policy, block navigation away from the app and the opening of new windows, and don't enable remote modules.
- Prompt content is plain text. Render it as React text only (never `dangerouslySetInnerHTML`) and never evaluate or execute it.
- Keep platform-specific code (global shortcut quirks, vibrancy, show-over-full-screen, tray vs menu bar, dock behavior) isolated in a small `platform` module so supporting other operating systems later doesn't mean hunting through the codebase.
- Two windows are a core requirement, not a later add-on: the main window (library + editor) and the frameless quick-launcher summoned by a global shortcut. Design the IPC API and the preload script so both windows share it from the start.

## Code conventions

- TypeScript `strict`, no `any` (use `unknown` and narrow), no non-null assertions without a comment.
- Prefer small pure functions and discriminated unions. Parse, don't validate: turn raw input into typed values at the boundary.
- `prompt-lang` has no runtime dependencies other than `yaml` and `zod`.
- Tests live next to the code (`*.test.ts`). Every parser case, lint rule, edit, and render behavior gets a test. Include round-trip tests for edits (apply the edit, re-parse, assert the structure and that comments and key order in the frontmatter survive).
- Format with Prettier, lint with ESLint. Keep both passing.
- **Never lose user data.** Write files atomically (write to a temp file in the same folder, then rename). If a file changes on disk while it's open in the editor, don't overwrite it silently: show a conflict choice. Never delete a user's file without confirmation.
- UI: follow the system light/dark setting, be keyboard-first, show visible focus states, and use proper ARIA patterns (combobox/listbox for the launcher's search and results, labeled form controls).
- Commit in small, logical steps with clear messages. Do not commit generated build output.

## Commands (fill in as they exist)

```
npm install
npm run dev                  # run the desktop app
npm test                     # run all tests
npm test -w prompt-lang      # run one workspace's tests
npm run typecheck            # tsc in every workspace
npm run lint                 # ESLint + Prettier check
npm run format               # Prettier write (CLAUDE.md is excluded)
npm run build                # electron-vite production build into apps/desktop/out
```

`npm run dev` fails with `Cannot read properties of undefined (reading 'isPackaged')` if `ELECTRON_RUN_AS_NODE` is set in the environment (some editor-integrated shells set it). Run `env -u ELECTRON_RUN_AS_NODE npm run dev` in that case.

To run the built app against a throwaway data folder (first-run testing, scripted UI checks over `--remote-debugging-port`), build first and launch Electron directly. `electron-vite dev` and `preview` reject unknown flags:

```
npm run build
npx electron apps/desktop --user-data-dir=/tmp/promptweaver-try --remote-debugging-port=9333
```

## Build order

1. **Phase 1: scaffold + `prompt-lang`.** Monorepo, electron-vite app that opens a window, and the full `prompt-lang` package with tests. No real UI yet.
2. **Phase 2: library.** Main-process file access, library folder picker, file watcher, the `SearchIndex` interface with its MiniSearch implementation and contract tests, library browser UI, starter prompts.
3. **Phase 3: fill-in form + output.** A shared, keyboard-friendly `FillForm` component driven by `formFor`, with live preview, copy to clipboard, and remembered last-used values. It must work in both the main window and the launcher.
4. **Phase 4: quick launcher (headline feature).** Global shortcut, pre-created hidden frameless window, alias-first search, form, copy, hide, new-prompt-from-clipboard action, built-in `{{clipboard}}` captured at summon time, tray/menu-bar presence, configurable hotkey. Built right after the form so the core loop (hotkey, find, fill, copy) works end to end early. Hit the performance targets in the Quick launcher section, and add a dev-only measurement of hotkey-to-first-paint so the targets are verified, not guessed.
5. **Phase 5: editor.** CodeMirror 6 with chips, completion, hover, lint, fields panel, make-field-from-selection, wrap-in-condition.
6. **Phase 6: polish.** Starter pack of 15-20 good prompts, import/export, packaging, README.

Work one phase at a time. Stop at the end of each phase and summarize what exists, what's untested, and any decisions that need my input.

## Later ideas (not v1: do not build, but don't design them out)

- Open the rendered prompt in a chat app (Claude, ChatGPT) via a prefill URL, where supported (Shift+Enter). Watch for URL length limits.
- Approximate token/character count in the preview.
- Prompt packs: import a folder, zip, or GitHub URL of prompts as a unit. Publish the file format as a small open spec.
- A CLI built on `prompt-lang` (for example `promptweaver render code-review --language=Go`). Keep `prompt-lang` free of Electron, React, and Node-only APIs so this stays easy.
- Includes/partials using the reserved `{{> name}}` syntax.
- Git integration to version your prompts.

## Open questions (ask me before deciding)

- Toggle rendering when used as a placeholder (`yes`/`no` is the current guess).
- Whether to add field groups ("Advanced options") to the format.
- Default global hotkey (must avoid common conflicts).
- Platform priority for v1: macOS first, or macOS/Windows/Linux together? (Global shortcuts, vibrancy, and show-over-full-screen behave differently per platform. Linux/Wayland global shortcuts are unreliable.)
- Whether the launcher should auto-paste into the previous app in a later version (needs accessibility permission on macOS).
- Built-in `{{date}}` and `{{time}}` formats (ISO and 24-hour are assumed) and whether users will need custom formats or more built-ins (for example `{{weekday}}`).
- Open-source license for the repo (don't add a LICENSE file until decided).
- Default library location on first run (suggestion: `~/Documents/Promptweaver`, created with the starter prompts and changeable in settings).
