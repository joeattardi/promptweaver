import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Values } from 'prompt-lang'
import { FormHarness } from '../test/FormHarness'
import { formOf, REVIEW } from '../test/helpers'
import type { FillFormHandle } from './FillForm'

const review = formOf(REVIEW)

function setup(props: Partial<React.ComponentProps<typeof FormHarness>> = {}) {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  const onValues = vi.fn<(values: Values) => void>()
  render(<FormHarness form={review} onSubmit={onSubmit} onValues={onValues} {...props} />)
  const last = (): Values => onValues.mock.lastCall?.[0] ?? {}
  return { user, onSubmit, onValues, last }
}

describe('FillForm controls', () => {
  it('labels every question, in form order, and marks required ones', () => {
    setup()
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Focus' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Tone' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Strict' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Count' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveAccessibleName(/^Code.*required/)
  })

  it('describes a field by its help text', () => {
    setup()
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAccessibleDescription(
      'Anything else?'
    )
  })

  it('shows the value an option inserts next to its label', () => {
    setup()
    expect(screen.getByText('Be encouraging.')).toBeInTheDocument()
    expect(screen.queryByText('TypeScript', { selector: '.truncate' })).not.toBeInTheDocument()
  })

  it('reports typing in a text field and a textarea', async () => {
    const { user, last } = setup()
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'hi')
    await user.type(screen.getByRole('textbox', { name: /^Code/ }), 'x := 1')
    expect(last()).toMatchObject({ note: 'hi', code: 'x := 1' })
  })

  it('reports a number, and null when it is cleared', async () => {
    const { user, last } = setup()
    const count = screen.getByRole('spinbutton', { name: 'Count' })
    await user.type(count, '3')
    expect(last()['count']).toBe(3)
    await user.clear(count)
    expect(last()['count']).toBeNull()
  })

  it('toggles with Space', async () => {
    const { user, last } = setup()
    await user.tab()
    screen.getByRole('switch', { name: 'Strict' }).focus()
    await user.keyboard(' ')
    expect(last()['strict']).toBe(true)
    await user.keyboard(' ')
    expect(last()['strict']).toBe(false)
  })

  it('shows the default for a value that was never set', () => {
    setup()
    expect(screen.getByRole('radio', { name: /TypeScript/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Bugs' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Security' })).not.toBeChecked()
  })
})

describe('select', () => {
  it('chooses an option by clicking it', async () => {
    const { user, last } = setup()
    await user.click(screen.getByRole('radio', { name: /Python/ }))
    expect(last()['language']).toBe('Python')
  })

  it('chooses with the number keys and moves focus there', async () => {
    const { user, last } = setup()
    screen.getByRole('radio', { name: /TypeScript/ }).focus()
    await user.keyboard('3')
    expect(last()['language']).toBe('Go')
    expect(screen.getByRole('radio', { name: /Go/ })).toHaveFocus()
    await user.keyboard('9') // there is no ninth option
    expect(last()['language']).toBe('Go')
  })

  it('chooses with Up and Down', async () => {
    const { user, last } = setup()
    screen.getByRole('radio', { name: /TypeScript/ }).focus()
    await user.keyboard('{ArrowDown}')
    expect(last()['language']).toBe('Python')
    await user.keyboard('{ArrowUp}')
    expect(last()['language']).toBe('TypeScript')
  })

  it('jumps to an option by typing its first letters', async () => {
    const { user, last } = setup()
    screen.getByRole('radio', { name: /TypeScript/ }).focus()
    await user.keyboard('g')
    expect(last()['language']).toBe('Go')
    await user.keyboard('{Control>}p{/Control}') // shortcuts are not type-ahead
    expect(last()['language']).toBe('Go')
  })

  it('chooses by label when the options are a label-to-text map', async () => {
    const { user, last } = setup()
    await user.click(screen.getByRole('radio', { name: /Blunt/ }))
    expect(last()['tone']).toBe('Blunt')
  })

  it('uses a drop-down for a long list of options', async () => {
    const options = Array.from({ length: 12 }, (_, i) => `Option${i + 1}`)
    const form = formOf(
      `---\ntitle: T\nfields:\n  pick: { type: select, required: true, options: [${options.join(', ')}] }\n---\n{{pick}}`
    )
    const user = userEvent.setup()
    const onValues = vi.fn<(values: Values) => void>()
    render(<FormHarness form={form} onValues={onValues} />)
    const select = screen.getByRole('combobox', { name: /^Pick/ })
    expect(select).toHaveValue('')
    await user.selectOptions(select, 'Option7')
    expect(onValues.mock.lastCall?.[0]).toEqual({ pick: 'Option7' })
  })

  it('has nothing chosen when a required select has no default', () => {
    const form = formOf(
      '---\ntitle: T\nfields:\n  pick: { type: select, required: true, options: [A, B] }\n---\n{{pick}}'
    )
    render(<FormHarness form={form} />)
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).checked)).toEqual([
      false,
      false
    ])
  })
})

describe('multiselect', () => {
  it('is one tab stop, with Up and Down moving between the choices', async () => {
    const { user } = setup()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    boxes[0]?.focus()
    await user.keyboard('{ArrowDown}')
    expect(boxes[1]).toHaveFocus()
    expect(boxes.map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(boxes[2]).toHaveFocus() // stops at the end
    await user.keyboard('{ArrowUp}')
    expect(boxes[1]).toHaveFocus()
  })

  it('toggles the focused choice with Space, keeping the order of the options', async () => {
    const { user, last } = setup()
    screen.getByRole('checkbox', { name: 'Bugs' }).focus()
    await user.keyboard('{ArrowDown}{ArrowDown} ')
    expect(last()['focus']).toEqual(['Bugs', 'Security'])
    await user.keyboard('{ArrowUp} ')
    expect(last()['focus']).toEqual(['Bugs', 'Performance', 'Security'])
    await user.keyboard(' ')
    expect(last()['focus']).toEqual(['Bugs', 'Security'])
  })

  it('goes to the next field with Tab', async () => {
    const { user } = setup()
    screen.getByRole('checkbox', { name: 'Bugs' }).focus()
    await user.tab()
    expect(screen.getByRole('radio', { name: /Gentle/ })).toHaveFocus()
  })
})

describe('submitting from the keyboard', () => {
  it('submits on Enter in a single-line field', async () => {
    const { user, onSubmit } = setup()
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'x{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await user.type(screen.getByRole('spinbutton', { name: 'Count' }), '2{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('inserts a newline for Enter in a textarea, and submits on Ctrl+Enter', async () => {
    const { user, onSubmit, last } = setup()
    const code = screen.getByRole('textbox', { name: /^Code/ })
    await user.type(code, 'a{Enter}b')
    expect(last()['code']).toBe('a\nb')
    expect(onSubmit).not.toHaveBeenCalled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(last()['code']).toBe('a\nb') // no newline from the shortcut
  })

  it('submits on Cmd+Enter from any control', async () => {
    const { user, onSubmit } = setup()
    screen.getByRole('radio', { name: /Python/ }).focus()
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    screen.getByRole('checkbox', { name: 'Bugs' }).focus()
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('does not submit on plain Enter from a list or a switch', async () => {
    const { user, onSubmit } = setup()
    screen.getByRole('radio', { name: /Python/ }).focus()
    await user.keyboard('{Enter}')
    screen.getByRole('switch', { name: 'Strict' }).focus()
    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('never submits the form natively', async () => {
    const { user } = setup()
    const event = vi.fn((e: Event) => e.defaultPrevented)
    screen.getByRole('form', { name: 'Fill in the prompt' }).addEventListener('submit', event)
    await user.type(screen.getByRole('textbox', { name: 'Note' }), '{Enter}')
    expect(event).not.toHaveReturnedWith(false)
  })
})

describe('problems', () => {
  const issue = { fieldId: 'code', code: 'required', message: '"Code" is required.' } as const

  it('marks the field and ties the message to it', () => {
    setup({ issues: [issue] })
    const code = screen.getByRole('textbox', { name: /^Code/ })
    expect(code).toBeInvalid()
    expect(code).toHaveAccessibleDescription('"Code" is required.')
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeValid()
  })

  it('shows no problems by default', () => {
    setup()
    expect(screen.queryByText(/is required/)).not.toBeInTheDocument()
  })
})

describe('focus', () => {
  it('focuses the first control on request, but not otherwise', () => {
    const { unmount } = render(<FormHarness form={review} />)
    expect(document.body).toHaveFocus()
    unmount()
    render(<FormHarness form={review} autoFocus />)
    expect(screen.getByRole('radio', { name: /TypeScript/ })).toHaveFocus()
  })

  it('focuses a field through its handle', () => {
    const ref = createRef<FillFormHandle>()
    render(<FormHarness form={review} ref={ref} />)
    ref.current?.focusField('code')
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveFocus()
    ref.current?.focusField('focus')
    expect(screen.getByRole('checkbox', { name: 'Bugs' })).toHaveFocus()
    ref.current?.focusField('tone')
    expect(screen.getByRole('radio', { name: /Gentle/ })).toHaveFocus()
    ref.current?.focusField('nope') // unknown ids are ignored
    expect(screen.getByRole('radio', { name: /Gentle/ })).toHaveFocus()
  })
})

describe('paste from clipboard', () => {
  it('is offered only on from-clipboard fields, and only when asked for', async () => {
    const onRefill = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(<FormHarness form={review} onRefill={onRefill} />)
    const buttons = screen.getAllByRole('button', { name: 'Paste from clipboard' })
    expect(buttons).toHaveLength(1)
    await user.click(buttons[0] as HTMLElement)
    expect(onRefill).toHaveBeenCalledWith('code')
    unmount()
    render(<FormHarness form={review} />)
    expect(screen.queryByRole('button', { name: 'Paste from clipboard' })).not.toBeInTheDocument()
  })

  it('does not change the accessible name of the field', () => {
    render(<FormHarness form={review} onRefill={() => undefined} />)
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveAccessibleName(/^Code.*required/)
  })
})
