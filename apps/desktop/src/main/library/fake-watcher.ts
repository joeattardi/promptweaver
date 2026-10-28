import type { FileEvent, WatchFactory, WatchListener } from './watcher'

/** A watcher that does nothing until a test fires events. For tests only. */
export function fakeWatcher() {
  const listeners: WatchListener[] = []
  const closed: boolean[] = []
  const factory: WatchFactory = async (_root, listener) => {
    const index = listeners.push(listener) - 1
    closed[index] = false
    return {
      close: async () => {
        closed[index] = true
      }
    }
  }
  return {
    factory,
    closed,
    emit: (event: FileEvent, which = listeners.length - 1) => listeners[which]?.onEvent(event)
  }
}
