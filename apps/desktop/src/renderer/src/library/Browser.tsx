import type { LibraryProblem } from '../../../shared/library'
import { DetailPane } from './DetailPane'
import { Sidebar } from './Sidebar'
import { useLibrary, type ReadyLibrary } from './store'
import { buttonClass, Notice, primaryButtonClass } from './ui'

/** The library: a bar with the folder, warnings, then the prompt list beside the selected prompt. */
export function Browser(props: { library: ReadyLibrary }): React.JSX.Element {
  const { library } = props
  const notice = useLibrary((s) => s.notice)
  const busy = useLibrary((s) => s.busy)
  const query = useLibrary((s) => s.query)
  const { chooseFolder, dismissNotice } = useLibrary.getState()
  const isEmpty = library.prompts.length === 0 && query === ''

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <div className="min-w-0">
          <h1 className="sr-only">Prompt library</h1>
          <p
            className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400"
            title={library.path}
          >
            {library.path}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {library.prompts.length} {library.prompts.length === 1 ? 'prompt' : 'prompts'}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void chooseFolder()}
          className={buttonClass}
        >
          Change folder…
        </button>
      </header>

      {(notice !== null || library.aliasConflicts.length > 0 || library.problems.length > 0) && (
        <div className="flex flex-col gap-2 border-b border-zinc-200 p-3 dark:border-zinc-700">
          {notice !== null && <Notice message={notice} onDismiss={dismissNotice} />}
          {library.aliasConflicts.length > 0 && (
            <AliasConflicts conflicts={library.aliasConflicts} />
          )}
          {library.problems.length > 0 && <UnreadableFiles problems={library.problems} />}
        </div>
      )}

      {isEmpty ? (
        <EmptyLibrary />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[20rem_1fr]">
          <Sidebar />
          <DetailPane library={library} />
        </div>
      )}
    </div>
  )
}

function EmptyLibrary(): React.JSX.Element {
  const busy = useLibrary((s) => s.busy)
  const { addStarters } = useLibrary.getState()
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-start gap-3">
        <h2 className="text-xl font-semibold tracking-tight">No prompts in this folder yet</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Add any Markdown file to the folder and it appears here. Or start with a few examples.
        </p>
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={() => void addStarters()}
          className={primaryButtonClass}
        >
          Add starter prompts
        </button>
      </div>
    </main>
  )
}

function AliasConflicts(props: { conflicts: ReadyLibrary['aliasConflicts'] }): React.JSX.Element {
  return (
    <div
      role="status"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">
        {props.conflicts.length === 1 ? 'An alias is' : `${props.conflicts.length} aliases are`}{' '}
        used by more than one prompt
      </p>
      <ul className="mt-1">
        {props.conflicts.map((c) => (
          <li key={c.alias}>
            <span className="font-mono">{c.alias}</span>: {c.ids.join(', ')}
          </li>
        ))}
      </ul>
    </div>
  )
}

function UnreadableFiles(props: { problems: LibraryProblem[] }): React.JSX.Element {
  return (
    <div
      role="status"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">
        {props.problems.length === 1 ? '1 file' : `${props.problems.length} files`} couldn’t be
        loaded
      </p>
      <ul className="mt-1">
        {props.problems.map((p) => (
          <li key={p.file}>
            <span className="font-mono">{p.file}</span>: {p.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
