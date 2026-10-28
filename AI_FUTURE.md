# Local AI (future milestone)

Status: **planning only. Do not build before v1 is finished.** AI features are a v1 non-goal in `CLAUDE.md`, and this document does not change that. It records the thinking so the later milestone starts from a decision, not a blank page. Revisit all version and model choices when the work begins, because this space moves quickly.

## Constraints

- Free app, no budget for hosted APIs (OpenAI, Anthropic, etc.).
- Local-only inference. No accounts, no API keys, no telemetry.
- Apple's Foundation Models are Swift-only, need macOS 26 and Apple Intelligence, and are Mac-only. They are not a viable foundation.
- The model download is the one network request this feature needs. It must be opt-in with clear explanation (see "User experience").

## Chosen approach: node-llama-cpp

[`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp) wraps llama.cpp. Reasons:

- Ships prebuilt binaries (Metal on macOS, CUDA/Vulkan elsewhere). No separate daemon to manage.
- Loads any GGUF model.
- Built-in JSON-schema and grammar-constrained output. Small models need this to be reliable.
- Embedding support, so one dependency covers both generation and semantic search.

Alternatives considered:

| Option | Verdict |
|---|---|
| llama.cpp `llama-server` sidecar | Same engine, more plumbing (child process, localhost port). No gain. |
| Bundling Ollama | Avoid. Separate daemon and model store, awkward to sign and notarize. Instead, optionally support an *existing* Ollama / LM Studio on `localhost:11434` as an alternative provider. |
| Transformers.js / WebLLM | Fine for embeddings or tiny models, slower and weaker for generation. A possible embedding backend. |
| Apple Foundation Models | Optional extra backend on supported Macs via a Swift helper binary. Not the foundation. |

## Design principles

- **Propose, then verify.** The model proposes; `prompt-lang` (`parse`, `lint`, `validateValues`) checks the result, and edits go through `edits.*`. A bad model answer must never corrupt a file. The UI never keeps a second model of the prompt.
- **Structured output only.** Use schema-constrained JSON for anything that feeds an edit.
- **Never block the launcher.** Hotkey-to-paint targets in `CLAUDE.md` still apply. Any model work in the launcher runs asynchronously after first paint, and the user can always override or ignore it.
- **Small models do narrow tasks.** Classification, extraction, and structured suggestions. Not long-form writing.
- **Every feature is optional and degrades gracefully.** With no model installed, the app behaves exactly as it does today.

## Architecture

- The **main process owns the model**, like it owns the library index. Renderers (main window and launcher) reach it over the shared typed IPC API. Validate IPC inputs in main.
- Run inference in an **Electron utility process**, not the main process, so the UI never stalls.
- Hide the engine behind a small interface, mirroring `SearchIndex`. Nothing outside the implementation file imports `node-llama-cpp`.

```ts
interface LocalLLM {
  status(): ModelStatus; // not-installed | downloading | loading | ready | error
  generate<T>(req: { prompt: string; schema: JsonSchema; signal?: AbortSignal }): Promise<T>;
  embed(texts: string[]): Promise<number[][]>;
}
```

- Generation and embeddings may use **different models**. Users who only want better search can skip the larger generation model.
- Semantic search is added behind `SearchIndex` (blended with MiniSearch), with embeddings precomputed at index time and updated from the file watcher. The exact-alias-first rule still holds.
- A provider abstraction allows alternative backends later: bundled llama.cpp (default), existing Ollama/LM Studio, Apple Foundation Models.
- Add a shared contract test suite for `LocalLLM` implementations, as with `SearchIndex`. Use a fake implementation for UI and flow tests so CI never needs a real model.

## User experience

- **No model in the installer.** A useful quantized small model is roughly 1-3 GB.
- An opt-in **"Enable local AI"** step in settings: explains what it does, that the download is the only network request, downloads one recommended model with progress and cancel, and offers "choose a model file" instead.
- Gate on available RAM and chip. Intel Macs and low-RAM machines get a warning or the feature stays off.
- Show clearly when the model is loading, working, or unavailable. Never leave a button that silently does nothing.
- Models live in the app data directory, removable from settings (with confirmation).
- Pick a permissively licensed model (Qwen-family small models have been Apache 2.0). Gemma and Llama have custom terms to review. Re-check the landscape at implementation time.

## Feature ideas, in priority order

### Start here

1. **Semantic search.** Small embedding model blended into search so "summarize meeting" finds "Recap notes". Useful daily, needs only an embedding model, cheap at query time.
2. **"Turn this into a template."** Extension of capture from clipboard. The model reads a pasted prompt and proposes fields (which spans are variable, a type for each, options for selects) as constrained JSON, applied through `edits.*` and verified with `lint`. The headline feature.
3. **Suggest metadata.** Title, description, tags, and aliases. Aliases are checked against the library for collisions.

### Authoring helpers

4. Suggest options for a `select` / `multiselect` (for example `language` gives `TypeScript, Python, Go, Rust`).
5. Smarter "make field from selection": suggest id, type, and default.
6. Explain or fix a lint diagnostic in plain language. Only if the existing quick fixes prove insufficient.
7. Detect conditional patterns and offer `wrapIf`.

### Library management

8. Auto-tag and categorize imported packs (background batch, latency irrelevant).
9. Flag duplicate or near-duplicate prompts using embeddings.

### Launcher (experimental, gated on measured latency)

10. Rank prompts by what is on the clipboard (code ranks "Code Review" higher). Classifier or embedding match only, no full generation.
11. Pre-fill fields from clipboard text (for example detect the language of pasted code), asynchronously after the form opens.
12. Natural-language launch ("review this go code"). Opt-in only, since it risks the muscle-memory flow.

### Deliberately not doing

- Generating whole prompts from a description. Small models write mediocre prompts and users will compare them to hosted chatbots. If ever added, frame it as a starting skeleton.
- Running the finished prompt locally to show output. Same quality problem, and it blurs what the app is for.
- Anything needing long context.

## First task: prototype before committing

The riskiest assumption is that a small local model (roughly 1-4B parameters) produces good enough output for "turn this into a template". Before any UI, integration, or packaging work:

1. Run node-llama-cpp in a throwaway script against 10-20 real prompts, with 2-3 candidate models.
2. Use schema-constrained output and validate each result with `prompt-lang` (`parse`, `lint`).
3. Judge the proposed fields by hand: right spans, sensible types and options, no broken templates.
4. Also try an embedding model for semantic search on a realistic library.
5. Decide go / no-go and pick the default models from the results.

If the output is too weak, reconsider scope (metadata and search only) or the cloud section below, before building anything.

## Streamlined UX target

One switch, "Enable AI features", downloads a single recommended model. No model picker by default, no provider settings, no keys. Features appear in context (a button in the editor, better search results) and are absent when AI is off.

## Costs and risks

- Native binaries need `asarUnpack` configuration, separate arm64 and x64 builds, and signing and notarization of the extra `.node` and dylib files. Verify this early; it is the most likely source of packaging surprises.
- Large new dependency. Per `CLAUDE.md`, ask before adding it.
- Quality expectations: small models are inconsistent. Constrained output plus `prompt-lang` validation is what makes the features dependable.
- Performance on older hardware.
- The model download conflicts with the "no network requests" rule, so that rule and the app's CSP need an explicit, documented exception limited to the model download.

## Open questions for when this starts

- Which default generation and embedding models, and their licenses and sizes at that time?
- Download source for models (host ourselves vs. a public model hub), and checksum verification.
- Whether to support the existing-Ollama provider in the first release or later.
- Whether any feature warrants the Apple Foundation Models backend.
- How to update `CLAUDE.md` (non-goals, "no network" rule) when this milestone is approved.

## Deferred: cloud providers (bring your own account)

**Decision: local-only for now.** The priority features are narrow tasks (classification, extraction, structured output) that small local models handle well when output is schema-constrained and checked by `prompt-lang`. Cloud providers would add login or key setup, a privacy disclosure, a CSP exception, and provider settings, and the auth landscape is unstable. Revisit only if the local prototype (see "First task") proves too weak. The research below is kept for that case. These would contradict the "no network, no accounts" goals in `CLAUDE.md`, so they need an explicit decision and a documented opt-in. Findings below come largely from secondary sources (researched 2026-10-28) and must be re-verified against official docs before building.

Goal: let users power AI features with an account they already have, without generating and pasting an API key where possible. A stronger model would also make the "not doing" items (whole-prompt generation) more viable, though they should stay off when the local model is active.

### Auth options

| Provider | Status | Notes |
|---|---|---|
| **Claude (subscription login)** | **Do not build.** | Anthropic restricts Pro/Max subscription OAuth tokens to its own apps; third-party use is against its terms and reportedly blocked server-side. No public program for registering third-party OAuth clients. Claude API access is by API key only. |
| **Sign in with ChatGPT** | Investigate. | OpenAI is rolling out plan-usage sharing for third-party apps (Plus/Pro allowance, per-app caps). The developer quickstart (developers.openai.com/siwc/quickstart) describes an open-source flow issuing OAuth credentials for eligible Responses API requests with no API key. May be limited to partners or open-source projects (our license is undecided), and sign-in vs. plan-usage are separate grants. Sources disagree; very new. |
| **OpenRouter OAuth (PKCE)** | Viable today. | Browser login, then the app exchanges a code for a user-controlled API key. User pays OpenRouter directly and can reach Claude, GPT, Gemini, etc. Keys are revocable, can be labeled and given an expiry. Docs show a localhost callback; verify a loopback or custom-protocol callback for a desktop app. Downside: third-party intermediary, user needs credits. |
| **Paste an API key** | Fallback, under "Advanced". | OpenAI, Anthropic, or a local Ollama / LM Studio endpoint (`localhost:11434`). |

### UX ladder

1. Local model (default, private, free).
2. Sign in with ChatGPT, if confirmed available to us.
3. Sign in with OpenRouter (the route to Claude that respects Anthropic's terms).
4. Paste an API key (advanced).

### Requirements

- All providers sit behind the same provider abstraction as `LocalLLM`. Features must not care which backend is active.
- Store credentials in the OS keychain via Electron's `safeStorage`, never in the settings JSON.
- Show a clear disclosure whenever a cloud provider is active: prompt text leaves the machine.
- The network exception (and CSP) is scoped to the chosen provider's hosts, and only while that provider is enabled.
- Cloud providers are off by default; the app behaves exactly as today unless the user opts in.

### Cheap escape hatch

If power users ask, add an optional "custom endpoint" setting (Ollama, LM Studio, or any OpenAI-compatible URL). It needs almost no UX or maintenance and avoids all hosted-account auth.

### Open questions

- Is "Sign in with ChatGPT" available to a free desktop app, and under what license or approval terms?
- Does OpenRouter's OAuth accept a desktop callback (loopback port or custom protocol)?
- Is the extra complexity worth it if the local model covers the priority features?
- Which features, if any, should require a cloud provider?
