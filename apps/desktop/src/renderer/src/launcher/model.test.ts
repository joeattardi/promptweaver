import { describe, expect, it } from 'vitest'
import type { LauncherSuggestions, PromptSummary } from '../../../shared/ipc'
import { buildSections, clipboardPreview, flatten, moveActive, type LauncherItem } from './model'

function prompt(id: string, aliases: string[] = []): PromptSummary {
  return {
    id,
    folder: '',
    title: id,
    description: '',
    tags: [],
    aliases,
    conflictingAliases: [],
    errorCount: 0,
    warningCount: 0
  }
}

function suggestions(overrides: Partial<LauncherSuggestions> = {}): LauncherSuggestions {
  return { status: 'ready', groups: [], favoriteIds: [], ...overrides }
}

/** One short name per row, to compare orders. */
const names = (items: LauncherItem[]): string[] =>
  items.map((i) => (i.kind === 'prompt' ? i.prompt.id : '[new]'))

describe('buildSections with nothing typed', () => {
  it('shows each group under its heading, then the new-prompt action', () => {
    const sections = buildSections(
      '',
      suggestions({
        groups: [
          { kind: 'favorites', prompts: [prompt('a')] },
          { kind: 'recent', prompts: [prompt('b')] },
          { kind: 'all', prompts: [prompt('c')] }
        ]
      }),
      null
    )
    expect(sections.map((s) => s.heading)).toEqual(['Favorites', 'Recent', 'All prompts', null])
    expect(names(flatten(sections))).toEqual(['a', 'b', 'c', '[new]'])
  })

  it('marks favorites', () => {
    const [section] = buildSections(
      '  ',
      suggestions({
        groups: [{ kind: 'recent', prompts: [prompt('a'), prompt('b')] }],
        favoriteIds: ['b']
      }),
      null
    )
    expect(section?.items.map((i) => i.kind === 'prompt' && i.favorite)).toEqual([false, true])
  })

  it('offers the action but no prompts for an empty library', () => {
    expect(names(flatten(buildSections('', suggestions(), null)))).toEqual(['[new]'])
  })

  it.each(['loading', 'unconfigured', 'error'] as const)(
    'offers nothing while the library is %s',
    (status) => {
      expect(flatten(buildSections('', suggestions({ status }), null))).toEqual([])
    }
  )
})

describe('buildSections with a query', () => {
  const results = [prompt('code-review', ['cr']), prompt('crash-report')]

  it('shows the matches in the order search gave them, so an alias match stays first', () => {
    expect(names(flatten(buildSections('cr', suggestions(), results)))).toEqual([
      'code-review',
      'crash-report'
    ])
  })

  it('has no headings for matches', () => {
    expect(buildSections('cr', suggestions(), results).map((s) => s.heading)).toEqual([null])
  })

  it('shows nothing until results arrive', () => {
    expect(flatten(buildSections('cr', suggestions(), null))).toEqual([])
  })

  it('puts the new-prompt action first once "new" is typed', () => {
    expect(names(flatten(buildSections('new', suggestions(), [prompt('newsletter')])))).toEqual([
      '[new]',
      'newsletter'
    ])
    expect(names(flatten(buildSections('New prompt f', suggestions(), [])))).toEqual(['[new]'])
  })

  it('keeps a prompt whose alias is exactly what was typed above the action', () => {
    const items = flatten(
      buildSections('new', suggestions(), [prompt('news', ['new']), prompt('newsletter')])
    )
    expect(names(items)).toEqual(['news', '[new]', 'newsletter'])
  })

  it('puts the action last for two letters, so Enter never creates a file by accident', () => {
    expect(names(flatten(buildSections('ne', suggestions(), [prompt('next-steps')])))).toEqual([
      'next-steps',
      '[new]'
    ])
  })

  it('does not offer the action for other queries or one letter', () => {
    expect(names(flatten(buildSections('n', suggestions(), [prompt('notes')])))).toEqual(['notes'])
    expect(names(flatten(buildSections('review', suggestions(), [prompt('r')])))).toEqual(['r'])
  })

  it('does not offer the action without a library', () => {
    expect(flatten(buildSections('new', suggestions({ status: 'unconfigured' }), []))).toEqual([])
  })
})

describe('moveActive', () => {
  it('moves by the delta and stops at the ends', () => {
    expect(moveActive(0, 1, 5)).toBe(1)
    expect(moveActive(4, 1, 5)).toBe(4)
    expect(moveActive(0, -1, 5)).toBe(0)
    expect(moveActive(2, -10, 5)).toBe(0)
    expect(moveActive(2, 10, 5)).toBe(4)
  })

  it('stays at 0 with nothing to move through', () => {
    expect(moveActive(0, 1, 0)).toBe(0)
  })
})

describe('clipboardPreview', () => {
  it('is the first line that has text, collapsed to one line', () => {
    expect(clipboardPreview('\n\n  Hello \t  world\nsecond')).toBe('Hello world')
  })

  it('is shortened when long', () => {
    expect(clipboardPreview('x'.repeat(200))).toBe(`${'x'.repeat(80)}…`)
  })

  it('says so when there is nothing', () => {
    expect(clipboardPreview('')).toBe('The clipboard has no text')
    expect(clipboardPreview(' \n ')).toBe('The clipboard has no text')
  })
})
