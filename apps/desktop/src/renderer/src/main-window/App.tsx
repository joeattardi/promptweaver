import { useEffect, useState } from 'react'
import type { AppInfo } from '../../../shared/ipc'

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.api.getAppInfo().then(setInfo)
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <h1 className="text-3xl font-semibold tracking-tight">{info?.name ?? '…'}</h1>
      <p className="text-zinc-500 dark:text-zinc-400">Your prompt library will appear here.</p>
      {info && (
        <p className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          v{info.version} · {info.platform}
        </p>
      )}
    </main>
  )
}
