import type { ReactNode } from 'react'

export const buttonClass =
  'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 ' +
  'dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'

export const primaryButtonClass =
  'rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50'

/** A message about the last action that failed. Announced to screen readers. */
export function Notice(props: { message: string; onDismiss: () => void }): React.JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
    >
      <p>{props.message}</p>
      <button type="button" onClick={props.onDismiss} className={`${buttonClass} shrink-0 py-0.5`}>
        Dismiss
      </button>
    </div>
  )
}

/** A centered full-window screen used for first run and errors. */
export function Screen(props: { children: ReactNode }): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-8 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex w-full max-w-lg flex-col gap-5">{props.children}</div>
    </main>
  )
}
