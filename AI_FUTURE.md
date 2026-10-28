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
