import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult, RendererApi } from '../shared/ipc'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

const api: RendererApi = {
  getAppInfo: () => invoke('app:get-info')
}

contextBridge.exposeInMainWorld('api', api)
