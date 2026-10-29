import { useEffect, useRef, useState } from 'react'
import type { PromptDetail } from '../../../shared/ipc'
import { FillForm, type FillFormHandle } from '../fill/FillForm'
import { useFill } from '../fill/useFill'
import { hasMod, MOD } from '../platform'
import { HintBar } from './Kbd'
import { BackIcon } from '../icons'

/** The questions for the chosen prompt, in the launcher's window. */
export function FormStep(props: {
  detail: PromptDetail
  clipboard: string
  onBack: () => void
  onCopied: (title: string) => void
}): React.JSX.Element {
  const { detail, clipboard, onBack, onCopied } = props
  const { summary } = detail
  const formRef = useRef<FillFormHandle>(null)
  const fill = useFill(detail, formRef, { clipboard })
  const [showPreview, setShowPreview] = useState(false)

  const copied = fill.status?.kind === 'copied'
  useEffect(() => {
    if (copied) onCopied(summary.title)
  }, [copied, onCopied, summary.title])

  // Shortcuts that work wherever focus is inside the window.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.isComposing) return
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
      } else if (hasMod(event) && key === 'p') {
        event.preventDefault()
        setShowPreview((shown) => !shown)
      } else if (hasMod(event) && key === 'e') {
        event.preventDefault()
        void window.api.openInMainWindow(summary.id)
      } else if (hasMod(event) && event.key === 'Enter' && !event.defaultPrevented) {
        // The form handles this itself when a field has focus; this covers focus being elsewhere.
        event.preventDefault()
        void fill.submit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const hints = [
    { keys: `${MOD}↵`, label: 'Copy' },
    { keys: 'Tab', label: 'Next field' },
    { keys: `${MOD}P`, label: showPreview ? 'Hide preview' : 'Preview' },
    { keys: 'esc', label: 'Back' }
  ]

  return (
    <>
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to search"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:bg-black/[0.06] focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          <BackIcon />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[17px] leading-6 font-semibold">
          {summary.title}
        </h1>
        {summary.aliases[0] !== undefined && (
          <span className="shrink-0 rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
            {summary.aliases[0]}
          </span>
        )}
      </header>

      <div
        className={`overflow-y-auto overscroll-contain border-t border-black/[0.07] px-5 py-4 dark:border-white/10 ${
          showPreview ? 'max-h-[300px]' : 'max-h-[500px]'
        }`}
      >
        {fill.phase === 'loading' && <div aria-busy="true" className="h-24" />}
        {fill.phase === 'gone' && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {fill.status?.kind === 'error'
              ? fill.status.message
              : 'This prompt is no longer in the library.'}
          </p>
        )}
        {fill.phase === 'ready' && (
          <FillForm
            ref={formRef}
            form={fill.form}
            values={fill.values}
            issues={fill.issues}
            onChange={fill.setValue}
            onSubmit={() => void fill.submit()}
            onRefill={(fieldId) => void fill.refill(fieldId)}
            autoFocus
            compact
          />
        )}
      </div>

      {showPreview && (
        <section aria-label="Preview" className="border-t border-black/[0.07] dark:border-white/10">
          {/* The result is shown as plain text only. */}
          <pre className="max-h-[150px] overflow-auto px-5 py-3 font-mono text-xs break-words whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
            {fill.preview === '' ? '(empty)' : fill.preview}
          </pre>
        </section>
      )}

      <HintBar
        hints={hints}
        trailing={
          fill.status?.kind === 'error' ? (
            <span role="alert" className="font-medium text-red-700 dark:text-red-400">
              {fill.status.message}
            </span>
          ) : undefined
        }
      />
    </>
  )
}
