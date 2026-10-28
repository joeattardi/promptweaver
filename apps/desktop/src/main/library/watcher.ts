import { watch } from 'chokidar'
import { relative, sep } from 'node:path'
import { isPromptFileName } from './prompt-id'

export interface FileEvent {
  type: 'add' | 'change' | 'unlink'
  path: string
}

export interface WatchListener {
  onEvent(event: FileEvent): void
  onError(error: unknown): void
}

export interface WatchHandle {
  close(): Promise<void>
}

/** Starts watching `root`. Resolves once the watcher is live, so nothing is missed after that. */
export type WatchFactory = (root: string, listener: WatchListener) => Promise<WatchHandle>

/**
 * True for paths the library never cares about: anything inside a hidden
 * folder or starting with a dot, and files that aren't `*.md`. Only the part
 * below `root` is judged, so a library inside a hidden folder still works.
 */
export function isIgnored(root: string, path: string, isFile: boolean): boolean {
  const rel = relative(root, path)
  if (rel === '' || rel.startsWith('..')) return false
  const segments = rel.split(sep)
  if (segments.some((s) => s.startsWith('.'))) return true
  return isFile && !isPromptFileName(segments[segments.length - 1] ?? '')
}

export const chokidarWatch: WatchFactory = (root, { onEvent, onError }) =>
  new Promise((resolve, reject) => {
    const watcher = watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
      ignored: (path, stats) => isIgnored(root, path, stats?.isFile() === true),
      // Wait for a write to settle so a half-saved file isn't read.
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 }
    })
    watcher.on('add', (path) => onEvent({ type: 'add', path }))
    watcher.on('change', (path) => onEvent({ type: 'change', path }))
    watcher.on('unlink', (path) => onEvent({ type: 'unlink', path }))
    let ready = false
    watcher.on('error', (error) => {
      if (ready) return onError(error)
      // A failure while starting up: don't hang waiting for 'ready'.
      void watcher.close()
      reject(error)
    })
    watcher.once('ready', () => {
      ready = true
      resolve({ close: () => watcher.close() })
    })
  })
