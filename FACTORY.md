# Running Promptweaver as a software factory

This document describes what has to change in this repo so a feature can go from **spec to delivered result** without a person clicking around in the middle.

The intended workflow:

1. You write a spec for a feature, including acceptance criteria.
2. Claude implements it on a branch, runs the verification gates, reads the failures, fixes them, and repeats.
3. When every gate is green and an independent review has passed, Claude delivers a PR with evidence.
4. You review the evidence and the spec, not the process.

A factory is only as good as its **gates**. If a check doesn't exist, the loop can't use it, and you are back to testing by hand. Nearly all of the work below is about turning "I click around and see if it's right" into commands that exit 0 or non-zero.

The "enterprise" parts of the definition (org-wide governance, shared toolchains) don't apply to a one-person repo. What does apply: standardization, automation, and rules enforced by machine instead of by memory.

---

## 1. Where the repo is today

| Area                     | State                                                                                                      | Factory impact                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Unit tests               | Vitest, 22 test files, covering `prompt-lang`, search contract, main-process library/settings/atomic-write | Good base for logic.                                                   |
| Typecheck, lint, format  | `npm run typecheck`, `npm run lint` exist                                                                  | Good, but not combined into one gate.                                  |
| Renderer (React) tests   | None                                                                                                       | UI behavior is unverified.                                             |
| End-to-end / UI tests    | None. `CLAUDE.md` describes driving the built app over `--remote-debugging-port`, but nothing is scripted  | **The biggest gap.** This is exactly the "manually click around" step. |
| CI                       | No `.github/`                                                                                              | Nothing runs unless Claude or you run it.                              |
| Git hooks / Claude hooks | None (`.claude/` doesn't exist)                                                                            | Nothing stops a "done" claim with failing checks.                      |
| Specs                    | None. Intent lives in `CLAUDE.md` and chat                                                                 | The loop has no machine-readable definition of done.                   |
| Loop rules               | `CLAUDE.md` says "stop at the end of each phase and summarize"                                             | Contradicts an autonomous loop. Needs a per-spec rule.                 |
| Perf targets             | Stated in `CLAUDE.md` (launcher under ~100 ms), dev-only measurement planned for Phase 4                   | Not yet a gate.                                                        |

---

## 2. The target loop

```
spec (specs/NNN-name.md)
  │
  ▼
branch  factory/NNN-name
  │
  ▼
┌─► implement / fix
│     │
│     ▼
│   npm run verify        (typecheck + lint + unit + build)
│     │ fail ──────────────┐
│     ▼                    │
│   npm run verify:e2e     │   read output, diagnose, fix
│     │ fail ──────────────┤
│     ▼                    │
│   acceptance checks      │
│     │ fail ──────────────┘
│     ▼ pass
│   independent review (fresh context, read-only)
│     │ findings ──────────────► back into the loop
│     ▼ clean
│   PR with evidence
└── stop condition: iteration cap hit → write a blocked report, don't thrash
```

---

## 3. What to add, in order

Each step is useful on its own. Do them in this order, because later steps assume the earlier ones.

### Step 1: One gate command: `npm run verify`

A single command that is the definition of "the repo is healthy". Claude, hooks and CI all call the same thing, so they can never disagree.

```jsonc
// package.json scripts
"verify": "npm run typecheck && npm run lint && npm test && npm run build"
```

Rules:

- It must be non-interactive, deterministic and fail with a non-zero exit code.
- Output should be short on success and specific on failure, because Claude reads it to decide what to fix.
- Fix flaky tests when found; a flaky gate trains the loop to ignore failures.

### Step 2: Automated UI verification (the big one)

This replaces your manual clicking. Layers, cheapest first:

1. **Renderer component tests** (Vitest + jsdom + Testing Library) for `FillForm` and the launcher's search/result components. The launcher keyboard map in `CLAUDE.md` (Up/Down, number keys, Space, Cmd+Enter, Esc stepping back) is very testable at this level.
2. **Electron end-to-end tests** that launch the _built_ app against a throwaway user-data dir, drive the real windows, and assert on what they show. Playwright has first-class Electron support. A hand-rolled script over `--remote-debugging-port` also works (see the commands section of `CLAUDE.md`) but is more code to own.
3. **Screenshots as evidence**, not as assertions. E2E tests save screenshots of key states (library, form, launcher) to `artifacts/`, and the PR links them. This is how you review the UI without running the app.

Things that need design work to be testable:

- **The global hotkey can't be pressed in automation** (and Wayland/CI have no real global shortcuts). Add a test-only seam, for example an IPC call or `--test-mode` env var that invokes the same `summonLauncher()` code path the hotkey calls. Keep the seam out of production behavior and out of the prompt/IPC channel naming rules in `CLAUDE.md`.
- **Clipboard**: tests need to seed and read the system clipboard (or an injected clipboard in test mode) to verify `from: clipboard` and the copy step.
- **Fixture library**: E2E runs against a small fixed prompt folder under `apps/desktop/e2e/fixtures/`, never the real starter library or the user's data.
- **Launch hygiene**: unset `ELECTRON_RUN_AS_NODE`, use a unique `--user-data-dir` per run, and pick a free debugging port.

Add as `npm run verify:e2e`, kept separate from `verify` while it's slow. Fold it into `verify` once it runs in under a minute or two.

> **Needs your approval:** `CLAUDE.md` says to ask before adding dependencies. Playwright (`@playwright/test` or `playwright-core`) and Testing Library + jsdom would be new devDependencies. Neither ships in the app.

### Step 3: Spec format and a place to put specs

Create `specs/` with a template. A spec is the input to the factory, so it must be precise enough to be checked. The most important section is **acceptance criteria written as checks, not intentions**.

```markdown
# NNN: <feature name>

## Goal

One paragraph: what the user can do afterwards that they couldn't before.

## Out of scope

Things this spec deliberately doesn't do. (Include non-goals from CLAUDE.md that are tempting.)

## Acceptance criteria

Each item names how it is verified.

- [ ] AC1: <behavior>. Verified by: unit test in packages/prompt-lang (<what it asserts>)
- [ ] AC2: <behavior>. Verified by: e2e test "<name>" (<steps and assertions>)
- [ ] AC3: <non-functional, e.g. launcher visible < 100 ms>. Verified by: perf test, budget 100 ms

## Constraints

Files/areas that must not change, formats that must stay compatible, deps allowed (default: none).

## Decisions already made

Resolve any "Open questions" from CLAUDE.md that this spec touches, so Claude doesn't have to ask.

## Escalate instead of guessing if

Specific situations where the loop must stop and ask (e.g. needs a new dependency, changes the file format).
```

Rules that make specs work:

- Every acceptance criterion maps to a test that fails before the work and passes after. Claude writes the failing test first where practical.
- Anything you'd have checked by clicking becomes a criterion with an e2e test.
- Open questions in `CLAUDE.md` (toggle rendering, default hotkey, platform priority, license) must be answered in the spec, or the spec must say "stop and ask if needed".

### Step 4: Loop protocol in `CLAUDE.md`

Add a "Factory mode" section so the rules are loaded every session. Content to include:

- **Definition of done:** `npm run verify` (and `verify:e2e` once it exists) pass; every acceptance criterion is checked off with a pointer to its test; review step clean; no unrelated changes.
- **Iteration cap:** e.g. at most 8 fix cycles per failing gate, then stop and write a blocked report (what was tried, what the failure is, what decision is needed). Never loosen, skip or delete a test to get green. Changing an existing test requires saying why in the PR.
- **Branch and commits:** work on `factory/NNN-name`, commit in small logical steps (already a convention), never commit to `main`, never force-push.
- **Phase rule:** replace "stop at the end of each phase" with "stop at the end of each spec". Keep the summary: what exists, what's untested, decisions needed.
- **Escalation rules:** the existing "ask before" items (new dependencies, anything in the non-goals list, open questions) still stop the loop. List them in one place so they're unambiguous.
- **Data safety:** the "never lose user data" rules apply to tests too. Tests must never touch a real library folder or the real app data dir.

### Step 5: Guardrails that enforce, not suggest

`CLAUDE.md` is advice; hooks are enforcement. Add `.claude/settings.json` (checked in) with:

- **Stop hook:** when Claude tries to finish, run `npm run verify`. If it fails, block the stop and feed the output back. This is the mechanism that makes "loop until green" real instead of a promise.
- **PreToolUse guards:** block edits to `package-lock.json` outside of `npm install`, block `git push --force`, block committing to `main`, block writes outside the repo.
- **Permissions allowlist:** pre-approve the safe, frequent commands (`npm run *`, `git status/diff/log/add/commit`, test runs) so the loop isn't stalled by prompts. Keep dependency installs, pushes and deletes as prompts. (The `fewer-permission-prompts` skill can generate a starting list.)
- Use the `update-config` skill to write these; hooks are executed by the harness, so they have to live in settings, not in `CLAUDE.md`.

### Step 6: CI as the independent referee

Add `.github/workflows/ci.yml`:

- Triggers on PRs and pushes to `main`.
- `actions/setup-node` using `.nvmrc`, then `npm ci` (not `npm install`).
- Runs `npm run verify`. E2E on a macOS runner (the product is macOS-first, and Electron global-shortcut/window behavior differs by OS), using `xvfb` if a Linux job is added later.
- Uploads screenshots and test reports as artifacts.
- Branch protection on `main`: require CI green before merge.

The local loop can be fooled by environment drift; CI starts from a clean checkout and can't be. A PR that is green locally and red in CI means the loop isn't finished.

### Step 7: Independent review

The agent that wrote the code is a poor judge of it. Before delivery:

- Run the `code-review` skill (and `simplify`) on the branch diff. A fresh-context subagent can do this read-only, checking the diff against the spec's acceptance criteria and the `CLAUDE.md` rules.
- Specific checks that suit this repo: `prompt-lang` stayed pure (no Electron/React/Node imports); nothing outside the search implementation imports MiniSearch; no `any`, no unexplained non-null assertions; no `dangerouslySetInnerHTML`; IPC inputs validated in main; no network calls; no new dependency; the product name didn't leak into file formats or IPC channel names.
- Some of these are better as automated lint/test rules than review items. Dependency-boundary rules (`no-restricted-imports` in ESLint, or a small test that scans imports) turn them into gates. Add one whenever review catches the same thing twice.
- Run the `security-review` skill for specs that touch IPC, file access, the clipboard or the preload script.

### Step 8: Delivery format

The loop ends with a PR whose description is written for you as the reviewer:

- Spec link and a checklist of acceptance criteria, each linked to the test that proves it.
- Gate results (verify, e2e, CI) and the number of loop iterations used.
- Screenshots from the e2e run for any UI change.
- Perf numbers vs. budget, if the spec had one.
- Anything skipped, untested or decided unilaterally, stated plainly.
- Follow-ups noticed but deliberately not done.

Because specs are in the repo and the PR is the evidence, your review shifts from "does it work?" to "is this the right thing, and are the checks the right checks?"

---

## 4. Things that stay human

A factory still needs you at these points:

- **Writing and approving specs.** Garbage spec in, confidently wrong feature out.
- **Reviewing that the checks check the right thing.** A green gate only means the tests passed; weak tests pass too. Skim new tests in every PR.
- **Open questions and format changes.** The prompt file format (`format: 1`) is a public contract; changes to it should always be a deliberate decision.
- **Dependency additions, releases, packaging/signing, and the LICENSE decision.**
- **Taste.** Whether the launcher _feels_ fast and the form _feels_ right. Perf budgets and screenshots cover part of this; a short human pass on UI-heavy specs is still worth it, but it becomes a 2-minute review of screenshots instead of an hour of clicking.

---

## 5. Known limits and risks

- **Only as good as the tests.** The factory amplifies whatever the gates catch and silently ships whatever they don't. Expect to tighten gates after each escape (bug that got through): write the missing test as part of the fix.
- **Electron E2E can be flaky** (window timing, focus, blur-to-hide behavior of the launcher). Budget time to make it deterministic with explicit waits on app state, not sleeps.
- **Focus and blur behavior** (launcher hides on blur, focus returns to the previous app) is hard to assert headlessly. Verify what's observable (window visibility, clipboard content) and accept some residual manual checking for OS-level focus behavior.
- **Cost and runaway loops.** The iteration cap and blocked-report rule exist so a stuck loop stops cheaply.
- **Spec drift.** If specs aren't kept in sync after delivery, they become noise. Mark each spec's status in its header, and don't edit a delivered spec; write a new one.

---

## 6. Suggested rollout

| #   | Work                                                                                                     | Why first                                          |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `npm run verify`, `specs/` template, "Factory mode" section in `CLAUDE.md`                               | Cheap, and gives you the process immediately       |
| 2   | Stop hook + permissions allowlist in `.claude/settings.json`                                             | Makes the loop self-enforcing                      |
| 3   | CI workflow + branch protection                                                                          | Clean-room referee                                 |
| 4   | Renderer component tests (needs approval for jsdom/Testing Library)                                      | Covers form and launcher keyboard behavior cheaply |
| 5   | Electron E2E harness, fixture library, test seam for the launcher hotkey (needs approval for Playwright) | Retires manual clicking                            |
| 6   | Perf gate for launcher show time (pairs with the Phase 4 measurement)                                    | Turns the stated targets into enforced budgets     |
| 7   | Dependency-boundary lint rules; review and security-review in the delivery step                          | Hardens the architecture rules                     |
| 8   | Pilot: pick one small spec, run it end to end, fix whatever the loop trips on                            | Proves the system before relying on it             |

Steps 1 to 3 are about an afternoon. Step 5 is the real investment, and everything else gets more valuable once it exists.

---

## 7. Decisions needed from you

1. **Dependencies:** OK to add Playwright (E2E) and jsdom + Testing Library (component tests) as devDependencies?
2. **Autonomy level:** should the loop open the PR itself, or stop at a green branch for you to open it? Should it ever merge?
3. **CI platform:** GitHub Actions on a macOS runner, or something else? Is the repo hosted on GitHub yet?
4. **Iteration cap:** is 8 fix cycles per gate a sensible default?
5. **Platform scope:** CI and E2E assumptions depend on the open question of macOS-only vs. cross-platform for v1.
6. **Phase rule:** confirm replacing "stop at end of each phase" with "stop at end of each spec" when running in factory mode (keep the old behavior for interactive sessions?).
