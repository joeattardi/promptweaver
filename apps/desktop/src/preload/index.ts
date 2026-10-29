import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  IpcArgs,
  IpcChannel,
  IpcEvent,
  IpcEventPayload,
  IpcResult,
  RendererApi
} from '../shared/ipc'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

/** Subscribes to a main-to-window message without exposing the Electron event object. */
function subscribe<E extends IpcEvent>(
  channel: E,
  listener: (payload: IpcEventPayload<E>) => void
): () => void {
  const handler = (_event: IpcRendererEvent, payload: IpcEventPayload<E>): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: RendererApi = {
  getAppInfo: () => invoke('app:get-info'),
  getLibraryState: () => invoke('library:get-state'),
  chooseLibraryFolder: () => invoke('library:choose-folder'),
  createDefaultLibrary: () => invoke('library:create-default'),
  addStarterPrompts: () => invoke('library:add-starters'),
  getPrompt: (id) => invoke('library:get-prompt', id),
  searchPrompts: (query) => invoke('library:search', query),
  openFill: (id) => invoke('fill:open', id),
  readClipboard: () => invoke('fill:read-clipboard'),
  copyPrompt: (id, values, clipboard) => invoke('fill:copy', id, values, clipboard),
  takePendingAction: () => invoke('app:take-pending'),
  newPromptFromClipboard: () => invoke('prompt:new-from-clipboard'),
  getFavorites: () => invoke('favorites:list'),
  toggleFavorite: (id) => invoke('favorites:toggle', id),
  getSettings: () => invoke('settings:get'),
  setLauncherHotkey: (accelerator) => invoke('settings:set-hotkey', accelerator),
  setLaunchAtLogin: (enabled) => invoke('settings:set-launch-at-login', enabled),
  hideLauncher: () => invoke('launcher:hide'),
  resizeLauncher: (height) => invoke('launcher:resize', height),
  openInMainWindow: (id) => invoke('launcher:open-in-main', id),
  openMainWindow: () => invoke('launcher:open-main'),
  reportLauncherPaint: (milliseconds) => invoke('launcher:report-paint', milliseconds),
  onLibraryChanged: (listener) => subscribe('library:changed', listener),
  onLauncherSummon: (listener) => subscribe('launcher:summon', listener),
  onLauncherSuggestions: (listener) => subscribe('launcher:suggestions', listener),
  onLauncherShown: (listener) => subscribe('launcher:shown', () => listener()),
  onLauncherClosing: (listener) => subscribe('launcher:closing', () => listener()),
  onLauncherHidden: (listener) => subscribe('launcher:hidden', () => listener()),
  onFavoritesChanged: (listener) => subscribe('favorites:changed', listener),
  onSettingsChanged: (listener) => subscribe('settings:changed', listener),
  onOpenSettings: (listener) => subscribe('app:open-settings', () => listener()),
  onSelectPrompt: (listener) => subscribe('app:select-prompt', listener),
  onNotice: (listener) => subscribe('app:notice', listener)
}

contextBridge.exposeInMainWorld('api', api)
