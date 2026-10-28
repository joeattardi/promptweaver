import { useId, useRef, useState } from 'react'
import type { FieldValue, FormField } from 'prompt-lang'
import { typeAheadMatch } from './form-values'

export interface FieldProps<F extends FormField = FormField> {
  field: F
  value: FieldValue
  onChange: (value: FieldValue) => void
  /** Ids for the element(s) that describe this control (help text, error). */
  describedBy: string | undefined
  invalid: boolean
}

type Of<T extends FormField['type']> = Extract<FormField, { type: T }>

export const controlClass =
  'w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ' +
  'aria-[invalid=true]:border-red-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'

/** Selects with more options than this use a drop-down instead of a list of radio buttons. */
const MAX_LISTED_OPTIONS = 8

export function TextField(props: FieldProps & { id: string }): React.JSX.Element {
  return (
    <input
      id={props.id}
      type="text"
      autoComplete="off"
      spellCheck={false}
      value={typeof props.value === 'string' ? props.value : ''}
      aria-invalid={props.invalid}
      aria-describedby={props.describedBy}
      onChange={(e) => props.onChange(e.target.value)}
      className={controlClass}
    />
  )
}

export function TextareaField(props: FieldProps & { id: string }): React.JSX.Element {
  return (
    <textarea
      id={props.id}
      rows={5}
      spellCheck={false}
      value={typeof props.value === 'string' ? props.value : ''}
      aria-invalid={props.invalid}
      aria-describedby={props.describedBy}
      onChange={(e) => props.onChange(e.target.value)}
      className={`${controlClass} resize-y font-mono`}
    />
  )
}

export function NumberField(props: FieldProps<Of<'number'>> & { id: string }): React.JSX.Element {
  const { field } = props
  return (
    <input
      id={props.id}
      type="number"
      inputMode="decimal"
      min={field.min}
      max={field.max}
      value={typeof props.value === 'number' ? props.value : ''}
      aria-invalid={props.invalid}
      aria-describedby={props.describedBy}
      onChange={(e) => {
        const n = e.target.valueAsNumber
        props.onChange(e.target.value === '' || !Number.isFinite(n) ? null : n)
      }}
      className={`${controlClass} max-w-40`}
    />
  )
}

export function ToggleField(props: FieldProps<Of<'toggle'>> & { id: string }): React.JSX.Element {
  return (
    <input
      id={props.id}
      type="checkbox"
      role="switch"
      checked={props.value === true}
      aria-describedby={props.describedBy}
      onChange={(e) => props.onChange(e.target.checked)}
      className="size-4 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    />
  )
}

/**
 * One choice from a list. A short list is radio buttons: Up/Down move and choose,
 * 1-9 choose directly, and typing a few letters jumps to a match. A long list is a drop-down.
 * The label of the option is the value.
 */
export function SelectField(props: FieldProps<Of<'select'>> & { id: string }): React.JSX.Element {
  const { field, value } = props
  const name = useId()
  const typed = useRef({ text: '', at: 0 })
  const labels = field.options.map((o) => o.label)
  const current = typeof value === 'string' ? labels.indexOf(value) : -1

  if (field.options.length > MAX_LISTED_OPTIONS) {
    return (
      <select
        id={props.id}
        value={typeof value === 'string' ? value : ''}
        aria-labelledby={`${props.id}-label`}
        aria-invalid={props.invalid}
        aria-describedby={props.describedBy}
        onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
        className={controlClass}
      >
        {(value === null || value === '') && <option value="">Choose…</option>}
        {field.options.map((o) => (
          <option key={o.label} value={o.label}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  function choose(index: number, group: HTMLElement): void {
    const label = labels[index]
    if (label === undefined) return
    props.onChange(label)
    group.querySelectorAll<HTMLInputElement>('input[type=radio]')[index]?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return
    if (event.key >= '1' && event.key <= '9') {
      event.preventDefault()
      choose(Number(event.key) - 1, event.currentTarget)
    } else if (event.key !== ' ') {
      const now = Date.now()
      const text = now - typed.current.at < 700 ? typed.current.text + event.key : event.key
      typed.current = { text, at: now }
      const match = typeAheadMatch(labels, text, current)
      if (match >= 0) {
        event.preventDefault()
        choose(match, event.currentTarget)
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={`${props.id}-label`}
      aria-describedby={props.describedBy}
      aria-invalid={props.invalid}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-0.5"
    >
      {field.options.map((option, index) => (
        <label
          key={option.label}
          className="flex cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <input
            type="radio"
            name={name}
            checked={index === current}
            onChange={() => props.onChange(option.label)}
            className="accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          />
          <span className="w-3 text-xs text-zinc-400 tabular-nums" aria-hidden="true">
            {index + 1}
          </span>
          <span>{option.label}</span>
          {option.value !== option.label && (
            <span className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {option.value}
            </span>
          )}
        </label>
      ))}
    </div>
  )
}

/** Any number of choices. Up/Down move between them (one tab stop for the group) and Space toggles. */
export function MultiselectField(
  props: FieldProps<Of<'multiselect'>> & { id: string }
): React.JSX.Element {
  const { field, value } = props
  const chosen = Array.isArray(value) ? value : []
  const [active, setActive] = useState(0)

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0 || event.altKey || event.metaKey || event.ctrlKey) return
    event.preventDefault()
    const count = field.options.length
    const next = Math.max(0, Math.min(count - 1, active + step))
    setActive(next)
    event.currentTarget.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[next]?.focus()
  }

  function toggle(label: string): void {
    // Keep the form's order, whatever order the choices were ticked in.
    const next = new Set(chosen)
    if (!next.delete(label)) next.add(label)
    props.onChange(field.options.map((o) => o.label).filter((l) => next.has(l)))
  }

  return (
    <div
      role="group"
      aria-labelledby={`${props.id}-label`}
      aria-describedby={props.describedBy}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-0.5"
    >
      {field.options.map((option, index) => (
        <label
          key={option.label}
          className="flex cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <input
            type="checkbox"
            checked={chosen.includes(option.label)}
            tabIndex={index === active ? 0 : -1}
            onFocus={() => setActive(index)}
            onChange={() => toggle(option.label)}
            className="accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          />
          <span>{option.label}</span>
          {option.value !== option.label && (
            <span className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {option.value}
            </span>
          )}
        </label>
      ))}
    </div>
  )
}
