import {
  formFor,
  render,
  validateValues,
  type FieldValue,
  type FormField,
  type Values
} from 'prompt-lang'
import type { CopyResult, FillSession } from '../shared/ipc'
import type { PromptEntry } from './library/entry'

export interface FillServiceDeps {
  prompts: { entry(id: string): PromptEntry | null }
  state: {
    lastValues(id: string): Values
    remember(id: string, values: Values): Promise<void>
    markUsed(id: string): Promise<void>
  }
  /** Called after a prompt is copied, so the launcher's recents are current. */
  onCopied?: (id: string) => void
  clipboard: { readText(): Promise<string>; writeText(text: string): Promise<void> }
  now: () => Date
}

/** Starting a form and copying its result. Copying happens here so it works whichever window asks. */
export class FillService {
  constructor(private readonly deps: FillServiceDeps) {}

  async open(id: string): Promise<FillSession | null> {
    if (this.deps.prompts.entry(id) === null) return null
    const clipboard = await this.deps.clipboard.readText()
    return { remembered: this.deps.state.lastValues(id), clipboard }
  }

  readClipboard(): Promise<string> {
    return this.deps.clipboard.readText()
  }

  async copy(id: string, values: Values, clipboard: string): Promise<CopyResult> {
    const entry = this.deps.prompts.entry(id)
    if (entry === null) return { status: 'missing' }
    const issues = validateValues(entry.parsed, values)
    if (issues.length > 0) return { status: 'invalid', issues }

    const text = render(entry.parsed, values, { now: this.deps.now(), clipboard })
    await this.deps.clipboard.writeText(text)
    // The prompt is already copied; failing to remember anything isn't worth an error.
    const { state } = this.deps
    await Promise.all(
      [
        state.remember(id, rememberable(formFor(entry.parsed).fields, values)),
        state.markUsed(id)
      ].map((write) =>
        write.catch((error: unknown) => console.warn(`Couldn't save state for ${id}:`, error))
      )
    )
    this.deps.onCopied?.(id)
    return { status: 'copied' }
  }
}

/**
 * The answers worth keeping for next time. Fields filled from the clipboard are
 * left out: they take whatever is on the clipboard next time, and pasted text
 * (code, emails) shouldn't be kept on disk.
 */
export function rememberable(fields: readonly FormField[], values: Values): Values {
  const kept: Record<string, FieldValue> = {}
  for (const field of fields) {
    const value = values[field.id]
    if (value === undefined) continue
    if ((field.type === 'text' || field.type === 'textarea') && field.from === 'clipboard') continue
    kept[field.id] = value
  }
  return kept
}
