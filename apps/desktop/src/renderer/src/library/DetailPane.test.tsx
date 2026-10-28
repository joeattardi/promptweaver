import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PromptDetail } from '../../../shared/ipc'
import { detailOf, installApi, REVIEW } from '../test/helpers'
import { DetailPane } from './DetailPane'
import { useLibrary, type ReadyLibrary } from './store'

const library: ReadyLibrary = {
  status: 'ready',
  revision: 1,
  defaultPath: '/x',
  path: '/lib',
  prompts: [],
  problems: [],
  aliasConflicts: [{ alias: 'cr', ids: ['review', 'other'] }]
}

function show(detail: PromptDetail | null): void {
  act(() => useLibrary.setState({ detail }))
}

beforeEach(() => {
  useLibrary.setState(useLibrary.getInitialState(), true)
  installApi()
})

describe('DetailPane', () => {
  it('asks the user to pick a prompt when none is selected', () => {
    render(<DetailPane library={library} />)
    expect(screen.getByText('Select a prompt to see it here.')).toBeInTheDocument()
    act(() => useLibrary.setState({ query: 'zzz' }))
    expect(screen.getByText('Select a match to see it here.')).toBeInTheDocument()
  })

  it('opens on the Fill in tab, under the prompt title', async () => {
    show(detailOf(REVIEW))
    render(<DetailPane library={library} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Code Review' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Fill in' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('form', { name: 'Fill in the prompt' })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Fill in')
  })

  it('switches tabs by clicking and with the arrow keys, wrapping around', async () => {
    show(detailOf(REVIEW))
    const user = userEvent.setup()
    render(<DetailPane library={library} />)
    await user.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Questions' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Template' })).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Fill in' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Fill in' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus()
  })

  it('has one tab stop, on the selected tab', () => {
    show(detailOf(REVIEW))
    render(<DetailPane library={library} />)
    expect(screen.getByRole('tab', { name: 'Fill in' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('tabindex', '-1')
  })

  it('keeps the chosen tab when another prompt is selected', async () => {
    show(detailOf(REVIEW))
    const user = userEvent.setup()
    render(<DetailPane library={library} />)
    await user.click(screen.getByRole('tab', { name: 'Details' }))
    show(detailOf('---\ntitle: Other\n---\nHi', 'other'))
    expect(screen.getByRole('heading', { level: 2, name: 'Other' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
  })

  it('starts each prompt with its own answers', async () => {
    const user = userEvent.setup()
    show(detailOf(REVIEW))
    render(<DetailPane library={library} />)
    await user.type(await screen.findByRole('textbox', { name: 'Note' }), 'typed')
    show(detailOf(REVIEW.replace('Code Review', 'Second'), 'second'))
    expect(await screen.findByRole('textbox', { name: 'Note' })).toHaveValue('')
    show(detailOf(REVIEW))
    expect(await screen.findByRole('textbox', { name: 'Note' })).toHaveValue('')
  })

  it('takes the user to the details from the error note', async () => {
    show(detailOf(REVIEW, 'review', 1))
    const user = userEvent.setup()
    render(<DetailPane library={library} />)
    await user.click(await screen.findByRole('button', { name: 'See details' }))
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
  })

  it('lists problems, questions and the template as plain text on the Details tab', async () => {
    const detail = detailOf(
      '---\ntitle: T\nfields:\n  a: { type: text, required: true }\n---\n<b>{{a}}</b> {{if a}}'
    )
    detail.diagnostics = [
      {
        severity: 'error',
        code: 'unclosed-block',
        message: 'This {{if}} is never closed.',
        line: 6
      }
    ]
    detail.summary.aliases = ['cr']
    detail.summary.tags = ['code']
    detail.summary.conflictingAliases = ['cr']
    show(detail)
    const user = userEvent.setup()
    render(<DetailPane library={library} />)
    await user.click(screen.getByRole('tab', { name: 'Details' }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('This {{if}} is never closed.')).toBeInTheDocument()
    expect(within(panel).getByText(/is used by more than one prompt/)).toHaveTextContent(
      'review, other'
    )
    expect(within(panel).getByText('code')).toBeInTheDocument()
    expect(within(panel).getByText(/required/)).toBeInTheDocument()
    // The template is text, never markup.
    expect(panel.querySelector('pre')).toHaveTextContent('<b>{{a}}</b> {{if a}}')
    expect(panel.querySelector('b')).toBeNull()
  })

  it('says a prompt without questions is copied as it is', async () => {
    show(detailOf('---\ntitle: P\n---\nHi', 'p'))
    const user = userEvent.setup()
    render(<DetailPane library={library} />)
    await user.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.getByText('None. This prompt is copied as it is.')).toBeInTheDocument()
  })
})
