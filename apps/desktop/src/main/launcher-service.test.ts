import { describe, expect, it } from 'vitest'
import type { PromptSummary } from '../shared/ipc'
import { LauncherService, MAX_RECENT_SHOWN, MAX_REST_SHOWN } from './launcher-service'

function prompt(id: string, title = id): PromptSummary {
  return {
    id,
    folder: '',
    title,
    description: '',
    tags: [],
    aliases: [],
    conflictingAliases: [],
    errorCount: 0,
    warningCount: 0
  }
}

function setup(
  prompts: PromptSummary[],
  state: { favorites?: string[]; recents?: string[] } = {},
  status: 'loading' | 'unconfigured' | 'error' | 'ready' = 'ready'
) {
  let builds = 0
  const data = { prompts, favorites: state.favorites ?? [], recents: state.recents ?? [] }
  const service = new LauncherService({
    library: {
      status: () => status,
      prompts: () => {
        builds++
        return data.prompts
      }
    },
    state: { favorites: () => data.favorites, recents: () => data.recents }
  })
  return { service, data, builds: () => builds }
}

const ids = (groups: { prompts: PromptSummary[] }[]): string[][] =>
  groups.map((g) => g.prompts.map((p) => p.id))

describe('LauncherService', () => {
  it('lists favorites first, then recents, then everything else by title', () => {
    const { service } = setup(
      [prompt('z', 'Zed'), prompt('a', 'Apple'), prompt('m', 'Mango'), prompt('k', 'Kiwi')],
      {
        favorites: ['m'],
        recents: ['k', 'm']
      }
    )
    const { groups } = service.suggestions()
    expect(groups.map((g) => g.kind)).toEqual(['favorites', 'recent', 'all'])
    expect(ids(groups)).toEqual([['m'], ['k'], ['a', 'z']])
  })

  it('shows a prompt once, in the first group that has it', () => {
    const { service } = setup([prompt('a'), prompt('b')], { favorites: ['a'], recents: ['a', 'b'] })
    expect(ids(service.suggestions().groups)).toEqual([['a'], ['b']])
  })

  it('keeps favorites in the order they were starred', () => {
    const { service } = setup([prompt('a'), prompt('b'), prompt('c')], { favorites: ['c', 'a'] })
    expect(ids(service.suggestions().groups)[0]).toEqual(['c', 'a'])
  })

  it('leaves out empty groups and prompts that no longer exist', () => {
    const { service } = setup([prompt('a')], { favorites: ['gone'], recents: ['gone2'] })
    const { groups, favoriteIds } = service.suggestions()
    expect(groups.map((g) => g.kind)).toEqual(['all'])
    expect(favoriteIds).toEqual([])
  })

  it('reports every favorite so search results can show stars', () => {
    const { service } = setup([prompt('a'), prompt('b')], { favorites: ['b', 'a'] })
    expect(service.suggestions().favoriteIds).toEqual(['b', 'a'])
  })

  it('limits recents and the rest', () => {
    const many = Array.from({ length: MAX_REST_SHOWN + 50 }, (_, i) =>
      prompt(`p${String(i).padStart(3, '0')}`)
    )
    const { service } = setup(many, { recents: many.slice(0, 20).map((p) => p.id) })
    const { groups } = service.suggestions()
    expect(groups[0]?.prompts).toHaveLength(MAX_RECENT_SHOWN)
    expect(groups[1]?.prompts).toHaveLength(MAX_REST_SHOWN)
  })

  it('sorts titles the way people read them', () => {
    const { service } = setup([prompt('a', 'Step 10'), prompt('b', 'Step 2'), prompt('c', 'apple')])
    expect(ids(service.suggestions().groups)).toEqual([['c', 'b', 'a']])
  })

  it.each(['loading', 'unconfigured', 'error'] as const)(
    'has nothing to show while the library is %s',
    (status) => {
      const { service } = setup([prompt('a')], { favorites: ['a'] }, status)
      expect(service.suggestions()).toEqual({ status, groups: [], favoriteIds: [] })
    }
  )

  it('builds once and keeps the result until told to forget it', () => {
    const { service, data, builds } = setup([prompt('a')])
    service.suggestions()
    service.suggestions()
    expect(builds()).toBe(1)
    data.favorites = ['a']
    expect(service.suggestions().favoriteIds).toEqual([])
    service.invalidate()
    expect(service.suggestions().favoriteIds).toEqual(['a'])
    expect(builds()).toBe(2)
  })
})
