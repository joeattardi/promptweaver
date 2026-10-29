import { useEffect, useRef } from 'react'
import { FormStep } from './FormStep'
import { CheckIcon } from '../icons'
import { SearchStep } from './SearchStep'
import { useLauncher } from './useLauncher'

/** The quick launcher: find a prompt, answer its questions, and have it copied. */
export function App(): React.JSX.Element {
  const launcher = useLauncher()
  const root = useRef<HTMLDivElement>(null)

  useFitWindowToContent(root)
  useReportFirstPaint()

  return (
    <div
      ref={root}
      className="launcher-surface flex flex-col overflow-hidden text-zinc-900 dark:text-zinc-100"
    >
      {launcher.copied !== null ? (
        <div role="status" className="flex items-center gap-3 px-6 py-5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
            <CheckIcon />
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] leading-6 font-semibold">Copied to clipboard</span>
            <span className="block truncate text-[13px] text-zinc-600 dark:text-zinc-400">
              {launcher.copied.title}
            </span>
          </span>
        </div>
      ) : launcher.step.kind === 'form' ? (
        <FormStep
          // A different prompt starts with its own answers.
          key={launcher.step.detail.summary.id}
          detail={launcher.step.detail}
          clipboard={launcher.clipboard}
          onBack={launcher.backToSearch}
          onCopied={launcher.finishCopy}
        />
      ) : (
        <SearchStep launcher={launcher} />
      )}
    </div>
  )
}

/**
 * The window is exactly as tall as its content, so a short list is a short
 * window. The page measures itself and the main process resizes the window.
 */
function useFitWindowToContent(root: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const element = root.current
    if (element === null) return
    let last = 0
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height === last || height === 0) return
      last = height
      void window.api.resizeLauncher(height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])
}

/**
 * When the main process says the hotkey was pressed at a certain moment (only while
 * performance is being measured), report how long it took until the first frame was
 * painted with the window on screen. The page keeps rendering while hidden, so the
 * main process says when the window is actually shown.
 */
function useReportFirstPaint(): void {
  useEffect(() => {
    let pressedAt: number | null = null
    const offs = [
      window.api.onLauncherSummon((summon) => {
        pressedAt = summon.pressedAt
      }),
      window.api.onLauncherShown(() => {
        const started = pressedAt
        if (started === null) return
        pressedAt = null
        // Two frames: the first applies the new content, the second is on screen.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            void window.api.reportLauncherPaint(Date.now() - started)
          })
        )
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])
}
