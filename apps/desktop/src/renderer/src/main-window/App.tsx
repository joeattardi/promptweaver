import { useEffect } from 'react'
import type { LibraryState } from '../../../shared/ipc'
import { Browser } from '../library/Browser'
import { useLibrary } from '../library/store'
import { LibraryUnavailable, Welcome } from '../library/Welcome'
import { SettingsDialog } from '../settings/SettingsDialog'
import { useSettings } from '../settings/store'

export function App(): React.JSX.Element {
  const state = useLibrary((s) => s.state)

  useEffect(() => useSettings.getState().start(), [])
  useEffect(() => useLibrary.getState().start(), [])

  return (
    <>
      <LibraryScreen state={state} />
      <SettingsDialog />
    </>
  )
}

function LibraryScreen(props: { state: LibraryState | null }): React.JSX.Element {
  const { state } = props
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
