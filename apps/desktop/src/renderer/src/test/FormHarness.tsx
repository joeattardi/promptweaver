import { useState } from 'react'
import type { FieldValue, FormModel, Values } from 'prompt-lang'
import { FillForm, type FillFormProps } from '../fill/FillForm'

/** A FillForm that holds its own values, the way a window would. */
export function FormHarness(
  props: Partial<Omit<FillFormProps, 'form' | 'values'>> & {
    form: FormModel
    initial?: Values
    onValues?: (values: Values) => void
  }
): React.JSX.Element {
  const { form, initial = {}, onValues, onChange, ...rest } = props
  const [values, setValues] = useState<Values>(initial)
  return (
    <FillForm
      {...rest}
      form={form}
      values={values}
      onSubmit={props.onSubmit ?? (() => undefined)}
      onChange={(id: string, value: FieldValue) => {
        onChange?.(id, value)
        setValues((previous) => {
          const next = { ...previous, [id]: value }
          onValues?.(next)
          return next
        })
      }}
    />
  )
}
