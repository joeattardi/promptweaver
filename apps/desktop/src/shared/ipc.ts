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

/** What "New prompt from clipboard" did. */
export type CaptureResult =
  /** A prompt file now exists; `id` is its prompt id. */
  | { status: 'created'; id: string; title: string }
  /** The clipboard has no text, so nothing was created. */
  | { status: 'empty' }
  /** There is no library folder to put it in yet. */
  | { status: 'no-library' }
  | { status: 'error'; message: string }

/** A group of prompts for the launcher's empty-search view. */
export interface LauncherGroup {
  kind: 'favorites' | 'recent' | 'all'
  prompts: PromptSummary[]
}

/** What the launcher shows before anything is typed: favorites, then recents, then the rest. */
export interface LauncherSuggestions {
  /** 'loading' until the saved library has been read. */
  status: 'loading' | 'unconfigured' | 'error' | 'ready'
  groups: LauncherGroup[]
  /** Every favorite, so search results can be starred too. */
  favoriteIds: string[]
}

/** Sent to the launcher each time it is summoned, before it is shown. */
export interface LauncherSummon {
  /** The clipboard text at the moment of the hotkey, before the launcher took focus. */
  clipboard: string
  suggestions: LauncherSuggestions
  /** When the hotkey was pressed (epoch ms). Only set while measuring performance. */
  pressedAt: number | null
}

export interface HotkeyStatus {
  registered: boolean
  /** Why the shortcut isn't active, fit to show the user. */
  error: string | null
}

/** The settings the Settings screen shows and changes. */
export interface SettingsView {
  launcherHotkey: string
  defaultLauncherHotkey: string
  hotkey: HotkeyStatus
  launchAtLogin: boolean
  /** False when running from source, where registering a login item would point at Electron itself. */
  launchAtLoginAvailable: boolean
  platform: string
}

export type HotkeyResult =
  | { ok: true; warning: string | null; settings: SettingsView }
  /** The shortcut was refused; the previous one is still in effect. */
  | { ok: false; error: string; settings: SettingsView }

/** What the main window should do when it starts, because it was opened to do something. */
export interface PendingAction {
  selectId?: string
  openSettings?: boolean
  notice?: string
}

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
  /** The main window asks once it has loaded what it was opened to do (see `PendingAction`). */
  'app:take-pending': { args: []; result: PendingAction }
  /** Saves the clipboard text as a new prompt and opens it in the main window. */
  'prompt:new-from-clipboard': { args: []; result: CaptureResult }
  /** Starred prompt ids, in the order they were starred. */
  'favorites:list': { args: []; result: string[] }
  /** Stars or unstars a prompt. Gives the new list of favorites. */
  'favorites:toggle': { args: [id: string]; result: string[] }
  'settings:get': { args: []; result: SettingsView }
  /** Changes the launcher shortcut. Keeps the old one if the new one can't be registered. */
  'settings:set-hotkey': { args: [accelerator: string]; result: HotkeyResult }
  'settings:set-launch-at-login': { args: [enabled: boolean]; result: SettingsView }
  /** Hides the launcher without doing anything else. */
  'launcher:hide': { args: []; result: undefined }
  /** The height the launcher's content needs, in CSS pixels. Main fits the window to it. */
  'launcher:resize': { args: [height: number]; result: undefined }
  /** Hides the launcher and shows the main window with this prompt selected. */
  'launcher:open-in-main': { args: [id: string]; result: undefined }
  /** Hides the launcher and shows the main window as it is. */
  'launcher:open-main': { args: []; result: undefined }
  /** Milliseconds from hotkey to first paint. Ignored unless performance measuring is on. */
  'launcher:report-paint': { args: [milliseconds: number]; result: undefined }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Messages pushed from main to every window. */
export interface IpcEventContract {
  /** Something about the library changed; fetch `library:get-state` again. */
  'library:changed': { revision: number }
  /** The launcher is about to be shown. Reset to the search step and use this data. */
  'launcher:summon': LauncherSummon
  /** The launcher's empty-search view changed while it is open (the library finished loading, say). */
  'launcher:suggestions': LauncherSuggestions
  /** The launcher was hidden, by any route. Reset it so the next show starts clean. */
  'launcher:hidden': Record<string, never>
  'favorites:changed': { ids: string[] }
  'settings:changed': SettingsView
  /** Show the Settings screen (from the tray menu). */
  'app:open-settings': Record<string, never>
  /** Select this prompt in the library (after the launcher captured or opened it). */
  'app:select-prompt': { id: string }
  /** A short message for the main window to show (a tray action that failed, say). */
  'app:notice': { message: string }
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
  takePendingAction(): Promise<PendingAction>
  newPromptFromClipboard(): Promise<CaptureResult>
  getFavorites(): Promise<string[]>
  toggleFavorite(id: string): Promise<string[]>
  getSettings(): Promise<SettingsView>
  setLauncherHotkey(accelerator: string): Promise<HotkeyResult>
  setLaunchAtLogin(enabled: boolean): Promise<SettingsView>
  hideLauncher(): Promise<undefined>
  resizeLauncher(height: number): Promise<undefined>
  openInMainWindow(id: string): Promise<undefined>
  openMainWindow(): Promise<undefined>
  reportLauncherPaint(milliseconds: number): Promise<undefined>
  /** Each `on…` method calls `listener` for that message and returns an unsubscribe function. */
  onLibraryChanged(listener: (payload: IpcEventPayload<'library:changed'>) => void): () => void
  onLauncherSummon(listener: (payload: LauncherSummon) => void): () => void
  onLauncherSuggestions(listener: (payload: LauncherSuggestions) => void): () => void
  onLauncherHidden(listener: () => void): () => void
  onFavoritesChanged(listener: (payload: IpcEventPayload<'favorites:changed'>) => void): () => void
  onSettingsChanged(listener: (payload: SettingsView) => void): () => void
  onOpenSettings(listener: () => void): () => void
  onSelectPrompt(listener: (payload: IpcEventPayload<'app:select-prompt'>) => void): () => void
  onNotice(listener: (payload: IpcEventPayload<'app:notice'>) => void): () => void
}
