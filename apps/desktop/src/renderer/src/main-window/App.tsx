import { useEffect } from 'react'
import { Browser } from '../library/Browser'
import { useLibrary } from '../library/store'
import { LibraryUnavailable, Welcome } from '../library/Welcome'

export function App(): React.JSX.Element {
  const state = useLibrary((s) => s.state)

  useEffect(() => useLibrary.getState().start(), [])

  if (state === null) {
    return (
      <main
        aria-busy="true"
        className="flex min-h-screen items-center justify-center bg-white text-zinc-500 dark:bg-zinc-900"
      >
        Loading…
      </main>
    )
  }
  switch (state.status) {
    case 'unconfigured':
      return <Welcome defaultPath={state.defaultPath} />
    case 'error':
      return <LibraryUnavailable path={state.path} message={state.message} />
    case 'ready':
      return <Browser library={state} />
  }
}
