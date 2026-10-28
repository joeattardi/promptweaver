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
  copyPrompt: (id, values, clipboard) => invoke('fill:copy', id, values, clipboard),
  onLibraryChanged: (listener) => subscribe('library:changed', listener)
}

contextBridge.exposeInMainWorld('api', api)
