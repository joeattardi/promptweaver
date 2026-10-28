import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detailOf, installApi, REVIEW } from '../test/helpers'
import { FillPanel } from './FillPanel'

const detail = detailOf(REVIEW)
const preview = (): string =>
  screen.getByRole('region', { name: 'Preview' }).querySelector('pre')?.textContent ?? ''

async function open(api = installApi(), d = detail, onShowDetails = vi.fn()) {
  const user = userEvent.setup()
  render(<FillPanel detail={d} onShowDetails={onShowDetails} />)
  await screen.findByRole('form', { name: 'Fill in the prompt' })
  return { user, api, onShowDetails }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('starting values', () => {
  it('opens the form for the prompt and shows nothing until it arrives', async () => {
    const api = installApi({ openFill: () => new Promise<never>(() => undefined) })
    const { container } = render(<FillPanel detail={detail} onShowDetails={() => undefined} />)
    expect(api.openFill).toHaveBeenCalledWith('review')
    expect(container.querySelector('[aria-busy=true]')).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('fills a from-clipboard field from the clipboard', async () => {
    await open(installApi({ openFill: async () => ({ remembered: {}, clipboard: 'let x = 1' }) }))
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveValue('let x = 1')
    expect(preview()).toContain('let x = 1')
    expect(preview()).toContain('Clipboard: let x = 1')
  })

  it('restores remembered answers, and lets the clipboard win over a remembered from-clipboard field', async () => {
    await open(
      installApi({
        openFill: async () => ({
          remembered: { language: 'Go', focus: ['Security'], strict: true, count: 4, code: 'old' },
          clipboard: 'new'
        })
      })
    )
    expect(screen.getByRole('radio', { name: /Go/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Security' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Bugs' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Strict' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Count' })).toHaveValue(4)
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveValue('new')
  })

  it('does not take focus away from the prompt list', async () => {
    await open()
    expect(document.body).toHaveFocus()
  })

  it('says so when the prompt is gone', async () => {
    installApi({ openFill: async () => null })
    render(<FillPanel detail={detail} onShowDetails={() => undefined} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer in the library')
  })

  it('shows a failure to open the form', async () => {
    installApi({
      openFill: async () => {
        throw new Error('boom')
      }
    })
    render(<FillPanel detail={detail} onShowDetails={() => undefined} />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't copy: boom")
  })
})

describe('live preview', () => {
  it('follows the answers as they change', async () => {
    const { user } = await open()
    expect(preview()).toContain('You are a TypeScript reviewer. Be encouraging.')
    expect(preview()).toContain('Focus on: Bugs.')
    await user.click(screen.getByRole('radio', { name: /Blunt/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Performance' }))
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'thanks')
    expect(preview()).toContain('Be direct.')
    expect(preview()).toContain('Focus on: Bugs, Performance.')
    expect(preview()).toContain('Strict: no () thanks')
  })

  it('drops a conditional block when its answer is empty', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('checkbox', { name: 'Bugs' }))
    expect(preview()).not.toContain('Focus on')
  })

  it('shows a prompt with no questions as it is, and says so', async () => {
    await open(installApi(), detailOf('---\ntitle: Plain\n---\nJust text.\n', 'plain'))
    expect(screen.getByText(/No questions/)).toBeInTheDocument()
    expect(preview()).toBe('Just text.\n')
  })

  it('shows (empty) for a prompt that renders to nothing', async () => {
    await open(installApi(), detailOf('---\ntitle: Empty\n---\n', 'empty'))
    expect(preview()).toBe('(empty)')
  })
})

describe('copying', () => {
  async function fillCode(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByRole('textbox', { name: /^Code/ }), 'x := 1')
  }

  it('sends the answers and the form-open clipboard, then confirms', async () => {
    const api = installApi({ openFill: async () => ({ remembered: {}, clipboard: '' }) })
    const { user } = await open(api)
    await fillCode(user)
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(api.copyPrompt).toHaveBeenCalledTimes(1)
    const [id, values, clipboard] = api.copyPrompt.mock.calls[0] ?? []
    expect(id).toBe('review')
    expect(clipboard).toBe('')
    expect(values).toMatchObject({
      language: 'TypeScript',
      focus: ['Bugs'],
      tone: 'Gentle',
      strict: false,
      code: 'x := 1'
    })
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument()
  })

  it('copies on Ctrl+Enter from the textarea', async () => {
    const api = installApi()
    const { user } = await open(api)
    await fillCode(user)
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(api.copyPrompt).toHaveBeenCalledTimes(1))
  })

  it('copies on Enter in a single-line field', async () => {
    const api = installApi({ openFill: async () => ({ remembered: {}, clipboard: 'code' }) })
    const { user } = await open(api)
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'hi{Enter}')
    await waitFor(() => expect(api.copyPrompt).toHaveBeenCalledTimes(1))
  })

  it('copies a prompt with no questions straight away', async () => {
    const api = installApi()
    const { user } = await open(api, detailOf('---\ntitle: Plain\n---\nJust text.\n', 'plain'))
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(api.copyPrompt).toHaveBeenCalledWith('plain', {}, '')
  })

  it('stops copying a second time while the first is in flight', async () => {
    let finish: (() => void) | undefined
    const api = installApi({
      openFill: async () => ({ remembered: {}, clipboard: 'code' }),
      copyPrompt: () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'copied' })
        })
    })
    const { user } = await open(api)
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(screen.getByRole('button', { name: /Copy prompt/ })).toBeDisabled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(api.copyPrompt).toHaveBeenCalledTimes(1)
    finish?.()
    await screen.findByText('Copied to clipboard')
  })

  it('hides the confirmation after a moment, and when the answers change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = installApi({ openFill: async () => ({ remembered: {}, clipboard: 'code' }) })
    const { user } = await open(api)
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(2100))
    expect(screen.queryByText('Copied to clipboard')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    await screen.findByText('Copied to clipboard')
    await user.click(screen.getByRole('radio', { name: /Python/ }))
    expect(screen.queryByText('Copied to clipboard')).not.toBeInTheDocument()
  })
})

describe('missing answers', () => {
  it('copies nothing, marks the field and moves focus to it', async () => {
    const api = installApi()
    const { user } = await open(api)
    expect(screen.queryByText(/is required/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(api.copyPrompt).not.toHaveBeenCalled()
    const code = screen.getByRole('textbox', { name: /^Code/ })
    expect(code).toHaveFocus()
    expect(code).toBeInvalid()
    expect(screen.getByText('"Code" is required.')).toBeInTheDocument()
  })

  it('clears the problem as soon as it is fixed', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    await user.type(screen.getByRole('textbox', { name: /^Code/ }), 'x')
    expect(screen.queryByText(/is required/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^Code/ })).toBeValid()
  })

  it('focuses the first problem when several answers are wrong', async () => {
    const d = detailOf(
      '---\ntitle: T\nfields:\n  a: { type: text, required: true }\n  b: { type: number, min: 5 }\n---\n{{a}}{{b}}'
    )
    const { user } = await open(installApi(), d)
    await user.type(screen.getByRole('spinbutton', { name: 'B' }), '2')
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(screen.getByRole('textbox', { name: /^A/ })).toHaveFocus()
    expect(screen.getByText('"B" must be at least 5.')).toBeInTheDocument()
  })

  it('shows what the main process rejected if it disagrees', async () => {
    const api = installApi({
      openFill: async () => ({ remembered: {}, clipboard: 'code' }),
      copyPrompt: async () => ({
        status: 'invalid',
        issues: [{ fieldId: 'note', code: 'required', message: '"Note" is required.' }]
      })
    })
    const { user } = await open(api)
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('"Note" is required.')
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus()
  })

  it('tells the user when the prompt was renamed or deleted meanwhile', async () => {
    const api = installApi({
      openFill: async () => ({ remembered: {}, clipboard: 'code' }),
      copyPrompt: async () => ({ status: 'missing' })
    })
    const { user } = await open(api)
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('renamed or deleted')
  })

  it('shows a failure to copy', async () => {
    const api = installApi({
      openFill: async () => ({ remembered: {}, clipboard: 'code' }),
      copyPrompt: async () => {
        throw new Error('no clipboard')
      }
    })
    const { user } = await open(api)
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't copy: no clipboard")
    expect(screen.getByRole('button', { name: /Copy prompt/ })).toBeEnabled()
  })
})

describe('paste from clipboard', () => {
  it('refills the field and what {{clipboard}} shows, and copies that text', async () => {
    let clipboard = 'first'
    const api = installApi({
      openFill: async () => ({ remembered: {}, clipboard }),
      readClipboard: async () => clipboard
    })
    const { user } = await open(api)
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveValue('first')
    clipboard = 'second'
    await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveValue('second')
    expect(preview()).toContain('Clipboard: second')
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }))
    expect(api.copyPrompt.mock.calls[0]?.[2]).toBe('second')
    expect(api.copyPrompt.mock.calls[0]?.[1]).toMatchObject({ code: 'second' })
  })

  it('replaces what was typed', async () => {
    const api = installApi({ readClipboard: async () => 'pasted' })
    const { user } = await open(api)
    await user.type(screen.getByRole('textbox', { name: /^Code/ }), 'typed')
    await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveValue('pasted')
  })

  it('leaves the field alone and says so when the clipboard has no text', async () => {
    const api = installApi({
      openFill: async () => ({ remembered: {}, clipboard: 'kept' }),
      readClipboard: async () => '  '
    })
    const { user } = await open(api)
    await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveValue('kept')
    expect(await screen.findByRole('alert')).toHaveTextContent('The clipboard has no text.')
  })

  it('shows a failure to read the clipboard', async () => {
    const api = installApi({
      readClipboard: async () => {
        throw new Error('denied')
      }
    })
    const { user } = await open(api)
    await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't copy: denied")
  })
})

describe('prompt with errors', () => {
  it('warns and offers the details', async () => {
    const { user, onShowDetails } = await open(installApi(), detailOf(REVIEW, 'review', 2))
    expect(screen.getByRole('note')).toHaveTextContent('2 errors')
    await user.click(screen.getByRole('button', { name: 'See details' }))
    expect(onShowDetails).toHaveBeenCalled()
  })

  it('says nothing for a clean prompt', async () => {
    await open()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

describe('the file changing under the form', () => {
  it('keeps what was typed and picks up a new question', async () => {
    const api = installApi()
    const user = userEvent.setup()
    const { rerender } = render(<FillPanel detail={detail} onShowDetails={() => undefined} />)
    await screen.findByRole('form')
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'keep me')
    rerender(
      <FillPanel
        detail={detailOf(REVIEW.replace('{{note}}', '{{note}} {{extra}}'))}
        onShowDetails={() => undefined}
      />
    )
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('keep me')
    expect(screen.getByRole('textbox', { name: /^Extra/ })).toHaveValue('')
    expect(api.openFill).toHaveBeenCalledTimes(1)
  })
})
