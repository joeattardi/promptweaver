import { useEffect, useId, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react'
import type { FieldValue, FormField, FormModel, ValueIssue, Values } from 'prompt-lang'
import {
  MultiselectField,
  NumberField,
  SelectField,
  TextareaField,
  TextField,
  ToggleField,
  type FieldProps
} from './fields'
import { shownValue } from './form-values'

export interface FillFormHandle {
  /** Moves keyboard focus into the control for a field. */
  focusField(fieldId: string): void
}

export interface FillFormProps {
  form: FormModel
  values: Values
  onChange: (fieldId: string, value: FieldValue) => void
  /** Copy the result. Called for Enter in a single-line field and Cmd/Ctrl+Enter anywhere in the form. */
  onSubmit: () => void
  /** Shows a "Paste from clipboard" button on `from: clipboard` fields; called with that field's id. */
  onRefill?: (fieldId: string) => void
  /** Problems to show against their fields. */
  issues?: readonly ValueIssue[]
  /** Focus the first field when the form appears. */
  autoFocus?: boolean
  /** Shown inside the form after the last field, such as the Copy button. */
  footer?: ReactNode
  ref?: Ref<FillFormHandle>
}

/**
 * The questions for a prompt, driven entirely by its `FormModel`. Used by both the
 * main window and the quick launcher, so it knows nothing about either: it shows
 * values and reports changes.
 */
export function FillForm({
  form,
  values,
  issues = [],
  onChange,
  onSubmit,
  onRefill,
  autoFocus = false,
  footer,
  ref
}: FillFormProps): React.JSX.Element {
  const root = useRef<HTMLFormElement>(null)

  function focusField(fieldId: string): void {
    const group = [...(root.current?.querySelectorAll<HTMLElement>('[data-field]') ?? [])].find(
      (el) => el.dataset['field'] === fieldId
    )
    const target =
      group?.querySelector<HTMLElement>('input:checked, input[tabindex="0"]') ??
      group?.querySelector<HTMLElement>('input, textarea, select')
    target?.focus()
  }
  useImperativeHandle(ref, () => ({ focusField }))

  const firstId = form.fields[0]?.id
  useEffect(() => {
    if (autoFocus && firstId !== undefined) focusField(firstId)
    // Only when the form appears or the first question changes, not on every keystroke.
  }, [autoFocus, firstId])

  function onKeyDown(event: React.KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    const { target } = event
    const singleLine =
      target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number')
    if (event.metaKey || event.ctrlKey || singleLine) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    <form
      ref={root}
      aria-label="Fill in the prompt"
      noValidate
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-4"
    >
      {form.fields.map((field) => (
        <Question
          key={field.id}
          field={field}
          value={shownValue(field, values)}
          issue={issues.find((i) => i.fieldId === field.id)}
          onChange={(value) => onChange(field.id, value)}
          onRefill={onRefill ? () => onRefill(field.id) : undefined}
        />
      ))}
      {footer}
    </form>
  )
}

function Question(props: {
  field: FormField
  value: FieldValue
  issue: ValueIssue | undefined
  onRefill: (() => void) | undefined
  onChange: (value: FieldValue) => void
}): React.JSX.Element {
  const { field, issue } = props
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy =
    [field.help !== undefined ? helpId : null, issue ? errorId : null].filter(Boolean).join(' ') ||
    undefined
  const shared = {
    id,
    value: props.value,
    onChange: props.onChange,
    describedBy,
    invalid: issue !== undefined
  }
  const inline = field.type === 'toggle'

  return (
    <div
      data-field={field.id}
      className={`flex gap-x-3 gap-y-1 ${inline ? 'flex-row items-center' : 'flex-col'}`}
    >
      <div className={inline ? 'order-2' : ''}>
        {/* A label for single controls; a plain text label that the group points at for lists. */}
        {field.type === 'select' || field.type === 'multiselect' ? (
          <span id={`${id}-label`} className="text-sm font-medium">
            {field.label}
            {field.required && <Required />}
          </span>
        ) : (
          <label htmlFor={id} className="text-sm font-medium">
            {field.label}
            {field.required && <Required />}
          </label>
        )}
        {props.onRefill &&
          (field.type === 'text' || field.type === 'textarea') &&
          field.from === 'clipboard' && (
            <button
              type="button"
              onClick={props.onRefill}
              className="ml-3 text-xs text-blue-700 underline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-400"
            >
              Paste from clipboard
            </button>
          )}
        {field.help !== undefined && (
          <p id={helpId} className="text-xs text-zinc-500 dark:text-zinc-400">
            {field.help}
          </p>
        )}
      </div>
      <Control field={field} {...shared} />
      {issue && (
        <p id={errorId} className="order-3 text-xs font-medium text-red-700 dark:text-red-400">
          {issue.message}
        </p>
      )}
    </div>
  )
}

function Required(): React.JSX.Element {
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-red-600 dark:text-red-400">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  )
}

function Control(
  props: Omit<FieldProps, 'field'> & { field: FormField; id: string }
): React.JSX.Element {
  const { field, ...rest } = props
  switch (field.type) {
    case 'text':
      return <TextField field={field} {...rest} />
    case 'textarea':
      return <TextareaField field={field} {...rest} />
    case 'select':
      return <SelectField field={field} {...rest} />
    case 'multiselect':
      return <MultiselectField field={field} {...rest} />
    case 'toggle':
      return <ToggleField field={field} {...rest} />
    case 'number':
      return <NumberField field={field} {...rest} />
  }
}
