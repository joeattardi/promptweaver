// The typed IPC contract shared by main, preload and every renderer window.
// To add a method: add a channel to `IpcContract`, a method to `RendererApi`,
// wire it in the preload, and register a handler (with an args schema) in main.

import type { ValueIssue, Values } from 'prompt-lang'
import type { LibraryState, PromptDetail, PromptSummary } from './library'

export type { LibraryState, PromptDetail, PromptSummary }

export interface AppInfo {
  name: string
  version: string
  platform: string
}

/** What a library action did: the library as it is now, and why it failed if it did. */
export interface LibraryActionResult {
  state: LibraryState
  /** A message fit to show the user, or null if the action worked (or was cancelled). */
  error: string | null
}

/** What a window needs to open a prompt's form. */
export interface FillSession {
  /** The values last used with this prompt (may no longer fit the form; the window checks). */
  remembered: Values
  /** The clipboard text right now. Pre-fills `from: clipboard` fields and is `{{clipboard}}`. */
  clipboard: string
}

export type CopyResult =
  /** The finished prompt is on the clipboard. */
  | { status: 'copied' }
  /** Nothing was copied: these answers are missing or invalid. */
  | { status: 'invalid'; issues: ValueIssue[] }
  /** Nothing was copied: the prompt was deleted or renamed in the meantime. */
  | { status: 'missing' }

export interface IpcContract {
  'app:get-info': { args: []; result: AppInfo }
  'library:get-state': { args: []; result: LibraryState }
  /** Opens a folder picker. Nothing in the chosen folder is changed. */
  'library:choose-folder': { args: []; result: LibraryActionResult }
  /** First run: create the default library folder (with starter prompts if it has none). */
  'library:create-default': { args: []; result: LibraryActionResult }
  /** Add any missing starter prompts to the current library. Existing files are never touched. */
  'library:add-starters': { args: []; result: LibraryActionResult }
  'library:get-prompt': { args: [id: string]; result: PromptDetail | null }
  /** Best matches first; an exact alias match is always first. Empty query gives nothing. */
  'library:search': { args: [query: string]; result: PromptSummary[] }
  /** Starts filling in a prompt: its remembered answers and the current clipboard. Null if it's gone. */
  'fill:open': { args: [id: string]; result: FillSession | null }
  /** The clipboard text right now, for refilling a `from: clipboard` field after the form opened. */
  'fill:read-clipboard': { args: []; result: string }
  /**
   * Checks the answers, renders the prompt, and puts it on the clipboard.
   * `clipboard` is the text from `fill:open`, so the copy matches the preview.
   */
  'fill:copy': { args: [id: string, values: Values, clipboard: string]; result: CopyResult }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Messages pushed from main to every window. */
export interface IpcEventContract {
  /** Something about the library changed; fetch `library:get-state` again. */
  'library:changed': { revision: number }
}

export type IpcEvent = keyof IpcEventContract
export type IpcEventPayload<E extends IpcEvent> = IpcEventContract[E]

/** Exposed as `window.api` in both the main window and the launcher. */
export interface RendererApi {
  getAppInfo(): Promise<AppInfo>
  getLibraryState(): Promise<LibraryState>
  chooseLibraryFolder(): Promise<LibraryActionResult>
  createDefaultLibrary(): Promise<LibraryActionResult>
  addStarterPrompts(): Promise<LibraryActionResult>
  getPrompt(id: string): Promise<PromptDetail | null>
  searchPrompts(query: string): Promise<PromptSummary[]>
  openFill(id: string): Promise<FillSession | null>
  readClipboard(): Promise<string>
  copyPrompt(id: string, values: Values, clipboard: string): Promise<CopyResult>
  /** Calls `listener` whenever the library changes. Returns an unsubscribe function. */
  onLibraryChanged(listener: (payload: IpcEventPayload<'library:changed'>) => void): () => void
}
