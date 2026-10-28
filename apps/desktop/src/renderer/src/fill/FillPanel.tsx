import { useRef } from 'react'
import type { PromptDetail } from '../../../shared/ipc'
import { primaryButtonClass } from '../library/ui'
import { FillForm, type FillFormHandle } from './FillForm'
import { useFill } from './useFill'

const isMac = /Mac/.test(navigator.userAgent)
const SUBMIT_HINT = isMac ? '⌘↵' : 'Ctrl+Enter'

/** A prompt's questions beside a live preview of the finished prompt, with a Copy button. */
export function FillPanel(props: {
  detail: PromptDetail
  onShowDetails: () => void
}): React.JSX.Element {
  const { detail } = props
  const formRef = useRef<FillFormHandle>(null)
  const fill = useFill(detail, formRef)

  if (fill.phase === 'loading') return <div aria-busy="true" className="min-h-40" />
  if (fill.phase === 'gone') {
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {fill.status?.kind === 'error'
          ? fill.status.message
          : 'This prompt is no longer in the library.'}
      </p>
    )
  }

  const { errorCount } = detail.summary
  return (
    <div className="flex flex-col gap-4">
      {errorCount > 0 && (
        <p
          role="note"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          This prompt has {errorCount === 1 ? 'an error' : `${errorCount} errors`}, so the result
          may not look as intended.{' '}
          <button type="button" onClick={props.onShowDetails} className="underline">
            See details
          </button>
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          {fill.form.fields.length === 0 && (
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              No questions. This prompt is copied as it is.
            </p>
          )}
          <FillForm
            ref={formRef}
            form={fill.form}
            values={fill.values}
            issues={fill.issues}
            onChange={fill.setValue}
            onRefill={(fieldId) => void fill.refill(fieldId)}
            onSubmit={() => void fill.submit()}
            footer={
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={fill.busy}
                  onClick={() => void fill.submit()}
                  className={primaryButtonClass}
                >
                  Copy prompt <kbd className="ml-1 font-sans text-xs opacity-80">{SUBMIT_HINT}</kbd>
                </button>
                <p role="status" className="text-sm">
                  {fill.status?.kind === 'copied' && (
                    <span className="text-green-700 dark:text-green-400">Copied to clipboard</span>
                  )}
                </p>
                {fill.status?.kind === 'error' && (
                  <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                    {fill.status.message}
                  </p>
                )}
              </div>
            }
          />
        </div>
        <Preview text={fill.preview} />
      </div>
    </div>
  )
}

function Preview(props: { text: string }): React.JSX.Element {
  return (
    <section aria-label="Preview" className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold">Preview</h3>
      {/* The result is shown as plain text only. */}
      <pre className="max-h-[32rem] overflow-auto rounded-md bg-zinc-100 p-3 font-mono text-xs break-words whitespace-pre-wrap dark:bg-zinc-800">
        {props.text === '' ? '(empty)' : props.text}
      </pre>
    </section>
  )
}
