import { useState } from 'react'
import { formatAccelerator, recordAccelerator } from '../../../shared/accelerator'

/**
 * A button that shows a shortcut and, when pressed, listens for a new one.
 * Press the combination you want; Escape (or clicking away) cancels.
 */
export function HotkeyRecorder(props: {
  id: string
  value: string
  platform: string
  /** Whether `value` is actually registered with the system right now. */
  active: boolean
  describedBy?: string
  onChoose: (accelerator: string) => void
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [held, setHeld] = useState<string>('')
  const [problem, setProblem] = useState<string | null>(null)

  function stop(): void {
    setRecording(false)
    setHeld('')
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!recording) return
    // While recording, no key may do its normal job (Tab, Enter, Space would leave or re-press the button).
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      stop()
      setProblem(null)
      return
    }
    const recorded = recordAccelerator(event.nativeEvent, props.platform)
    switch (recorded.status) {
      case 'pending':
        setHeld(
          recorded.modifiers.length === 0
            ? ''
            : `${formatAccelerator(`${recorded.modifiers.join('+')}+A`, props.platform).slice(0, -1)}…`
        )
        break
      case 'rejected':
        setProblem(recorded.reason)
        break
      case 'ok':
        stop()
        setProblem(null)
        props.onChoose(recorded.accelerator)
        break
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        id={props.id}
        type="button"
        aria-describedby={props.describedBy}
        aria-pressed={recording}
        onClick={() => {
          setProblem(null)
          setRecording((r) => !r)
        }}
        onKeyDown={onKeyDown}
        onBlur={stop}
        className={`min-w-44 rounded-md border px-3 py-1.5 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          recording
            ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
            : 'border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700'
        }`}
      >
        {recording ? (
          held || 'Press the new shortcut…'
        ) : (
          <>
            <span className="font-mono">{formatAccelerator(props.value, props.platform)}</span>
            {!props.active && (
              <span className="ml-2 text-xs font-normal text-red-700 dark:text-red-400">
                not active
              </span>
            )}
          </>
        )}
      </button>
      {problem !== null && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  )
}
