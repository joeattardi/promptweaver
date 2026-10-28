// The typed IPC contract shared by main, preload and every renderer window.
// To add a method: add a channel to `IpcContract`, a method to `RendererApi`,
// wire it in the preload, and register a handler (with an args schema) in main.

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface IpcContract {
  'app:get-info': { args: []; result: AppInfo }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Exposed as `window.api` in both the main window and the launcher. */
export interface RendererApi {
  getAppInfo(): Promise<AppInfo>
}
