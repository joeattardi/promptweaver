import { useLibrary } from './store'
import { buttonClass, Notice, primaryButtonClass, Screen } from './ui'

/** First run: nothing exists on disk until one of these buttons is pressed. */
export function Welcome(props: { defaultPath: string }): React.JSX.Element {
  const appName = useLibrary((s) => s.appName)
  const busy = useLibrary((s) => s.busy)
  const notice = useLibrary((s) => s.notice)
  const { createDefault, chooseFolder, dismissNotice } = useLibrary.getState()

  return (
    <Screen>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{appName ? ` to ${appName}` : ''}
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Your prompts live as plain Markdown files in a folder you choose. Start with a new
          library, or point at a folder you already have.
        </p>
      </div>
      {notice !== null && <Notice message={notice} onDismiss={dismissNotice} />}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={() => void createDefault()}
          className={`${primaryButtonClass} py-2`}
        >
          Create a library with starter prompts
        </button>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Creates <span className="font-mono break-all">{props.defaultPath}</span>
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void chooseFolder()}
          className={`${buttonClass} mt-2 py-2`}
        >
          Choose an existing folder…
        </button>
      </div>
    </Screen>
  )
}

/** The saved library folder can't be opened (moved, unplugged, no permission). */
export function LibraryUnavailable(props: { path: string; message: string }): React.JSX.Element {
  const busy = useLibrary((s) => s.busy)
  const notice = useLibrary((s) => s.notice)
  const { chooseFolder, dismissNotice } = useLibrary.getState()

  return (
    <Screen>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Can’t open your library</h1>
        <p className="mt-2 font-mono text-sm break-all text-zinc-600 dark:text-zinc-400">
          {props.path}
        </p>
        <p className="mt-2 text-zinc-700 dark:text-zinc-300">{props.message}</p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Your files haven’t been changed. If the folder comes back, restart the app to use it
          again.
        </p>
      </div>
      {notice !== null && <Notice message={notice} onDismiss={dismissNotice} />}
      <div>
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={() => void chooseFolder()}
          className={primaryButtonClass}
        >
          Choose a different folder…
        </button>
      </div>
    </Screen>
  )
}
