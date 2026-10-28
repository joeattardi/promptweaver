import { useEffect, useMemo, useState, type RefObject } from 'react'
import { parse, render, validateValues, type FieldValue, type Values } from 'prompt-lang'
import type { FillSession, PromptDetail } from '../../../shared/ipc'
import type { FillFormHandle } from './FillForm'
import { initialValues } from './form-values'

export type FillStatus = { kind: 'copied' } | { kind: 'error'; message: string }

/** How long "Copied" stays on screen. */
const COPIED_MS = 2000

/**
 * The state behind one prompt's form: remembered and clipboard-filled starting values, what the
 * user has changed, validation, the live preview, and copying. Shared by every window that shows a form.
 * Give the component that calls this `key={promptId}` so each prompt starts fresh.
 */
export function useFill(detail: PromptDetail, formRef: RefObject<FillFormHandle | null>) {
  const { id } = detail.summary
  const parsed = useMemo(() => parse(detail.source), [detail.source])
  // undefined while loading, null if the prompt is gone.
  const [session, setSession] = useState<FillSession | null | undefined>(undefined)
  const [edits, setEdits] = useState<Values>({})
  // Problems are only shown against fields once the user has tried to copy.
  const [attempted, setAttempted] = useState(false)
  const [status, setStatus] = useState<FillStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => new Date())
  // Set when a field is refilled, so `{{clipboard}}` follows the text just pasted.
  const [refilled, setRefilled] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.openFill(id).then(
      (opened) => {
        if (cancelled) return
        setNow(new Date())
        setSession(opened)
      },
      (error: unknown) => {
        if (cancelled) return
        setSession(null)
        setStatus({ kind: 'error', message: describe(error) })
      }
    )
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (status?.kind !== 'copied') return
    const timer = setTimeout(() => setStatus(null), COPIED_MS)
    return () => clearTimeout(timer)
  }, [status])

  const clipboard = refilled ?? session?.clipboard ?? ''
  const values = useMemo<Values>(
    () => ({
      ...initialValues(detail.form, session?.remembered ?? {}, session?.clipboard ?? ''),
      ...edits
    }),
    [detail.form, session, edits]
  )
  const issues = useMemo(() => validateValues(parsed, values), [parsed, values])
  const preview = useMemo(
    () => render(parsed, values, { now, clipboard }),
    [parsed, values, now, clipboard]
  )

  function setValue(fieldId: string, value: FieldValue): void {
    setNow(new Date())
    setEdits((previous) => ({ ...previous, [fieldId]: value }))
    setStatus(null)
  }

  /** Replaces one `from: clipboard` field with what is on the clipboard now. */
  async function refill(fieldId: string): Promise<void> {
    try {
      const text = await window.api.readClipboard()
      if (text.trim() === '') {
        setStatus({ kind: 'error', message: 'The clipboard has no text.' })
        return
      }
      setRefilled(text)
      setValue(fieldId, text)
    } catch (error) {
      setStatus({ kind: 'error', message: describe(error) })
    }
  }

  /** Copies the finished prompt, or focuses the first answer that is missing. */
  async function submit(): Promise<void> {
    if (busy || !session) return
    setAttempted(true)
    const first = issues[0]
    if (first) {
      setStatus(null)
      formRef.current?.focusField(first.fieldId)
      return
    }
    setBusy(true)
    try {
      const result = await window.api.copyPrompt(id, values, clipboard)
      switch (result.status) {
        case 'copied':
          setStatus({ kind: 'copied' })
          break
        case 'invalid':
          setStatus({
            kind: 'error',
            message: result.issues[0]?.message ?? 'Some answers are invalid.'
          })
          if (result.issues[0]) formRef.current?.focusField(result.issues[0].fieldId)
          break
        case 'missing':
          setStatus({
            kind: 'error',
            message: 'This prompt was renamed or deleted. Pick it again from the list.'
          })
          break
      }
    } catch (error) {
      setStatus({ kind: 'error', message: describe(error) })
    } finally {
      setBusy(false)
    }
  }

  return {
    form: detail.form,
    /** 'loading' until the remembered values and clipboard have arrived. */
    phase:
      session === undefined
        ? ('loading' as const)
        : session === null
          ? ('gone' as const)
          : ('ready' as const),
    values,
    /** The problems to show: none until the first attempt to copy. */
    issues: attempted ? issues : [],
    preview,
    status,
    busy,
    setValue,
    refill,
    submit
  }
}

function describe(error: unknown): string {
  return `Couldn't copy: ${error instanceof Error ? error.message : String(error)}`
}
