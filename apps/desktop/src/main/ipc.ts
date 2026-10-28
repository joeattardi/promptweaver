import { BrowserWindow, ipcMain } from 'electron'
import type { z } from 'zod'
import type { IpcArgs, IpcChannel, IpcEvent, IpcEventPayload, IpcResult } from '../shared/ipc'
import { isTrustedUrl, type TrustedOrigins } from './trusted-urls'

type Handler<C extends IpcChannel> = (...args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>

/**
 * Registers a handler for one channel of the IPC contract. Rejects calls from
 * frames that aren't our own pages and validates arguments before the handler runs.
 */
export function handle<C extends IpcChannel>(
  origins: TrustedOrigins,
  channel: C,
  argsSchema: z.ZodType<IpcArgs<C>>,
  handler: Handler<C>
): void {
  ipcMain.handle(channel, (event, ...rawArgs: unknown[]) => {
    const senderUrl = event.senderFrame?.url ?? ''
    if (!isTrustedUrl(senderUrl, origins)) {
      throw new Error(`Rejected IPC call to ${channel} from untrusted sender`)
    }
    return handler(...argsSchema.parse(rawArgs))
  })
}

/** Sends a message to every open window. */
export function broadcast<E extends IpcEvent>(channel: E, payload: IpcEventPayload<E>): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
