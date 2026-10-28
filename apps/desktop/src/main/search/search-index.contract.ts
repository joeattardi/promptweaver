import { describe, expect, it } from 'vitest'
import type { IndexedPrompt, SearchIndex } from './types'

/** A prompt with empty fields, overridden by `fields`. */
export function prompt(id: string, fields: Partial<IndexedPrompt> = {}): IndexedPrompt {
  return { id, title: id, aliases: [], tags: [], description: '', body: '', ...fields }
}

/**
 * Behavior every SearchIndex implementation must have. A new implementation
 * drops in by calling this from its own test file with a factory.
 */
export function runSearchIndexContract(name: string, create: () => SearchIndex): void {
  const ids = (index: SearchIndex, query: string, limit?: number): string[] =>
    index.search(query, limit === undefined ? undefined : { limit }).map((r) => r.id)

  function indexOf(...prompts: IndexedPrompt[]): SearchIndex {
    const index = create()
    index.index(prompts)
    return index
  }

  describe(`SearchIndex contract: ${name}`, () => {
    describe('empty query and empty index', () => {
      it('returns nothing for an empty or blank query', () => {
        const index = indexOf(prompt('a', { title: 'Alpha' }))
        expect(ids(index, '')).toEqual([])
        expect(ids(index, '   \t\n')).toEqual([])
      })

      it('returns nothing from an empty index', () => {
        expect(ids(create(), 'anything')).toEqual([])
        expect(ids(indexOf(), 'anything')).toEqual([])
      })

      it('returns nothing for a query with no searchable characters', () => {
        const index = indexOf(prompt('a', { title: 'Alpha' }))
        expect(ids(index, '{{ }}')).toEqual([])
      })
    })

    describe('matching', () => {
      it('matches on a prefix of any field', () => {
        const index = indexOf(
          prompt('title', { title: 'Summarize text' }),
          prompt('tag', { tags: ['writing'] }),
          prompt('desc', { description: 'Translate between languages' }),
          prompt('body', { body: 'Explain recursion like I am five' })
        )
        expect(ids(index, 'summ')).toEqual(['title'])
        expect(ids(index, 'writ')).toEqual(['tag'])
        expect(ids(index, 'transl')).toEqual(['desc'])
        expect(ids(index, 'recurs')).toEqual(['body'])
      })

      it('is case-insensitive', () => {
        const index = indexOf(prompt('a', { title: 'Code Review' }))
        expect(ids(index, 'CODE review')).toEqual(['a'])
      })

      it('returns ids exactly as given, including folders', () => {
        const index = indexOf(prompt('code/review', { title: 'Review' }))
        expect(ids(index, 'review')).toEqual(['code/review'])
      })

      it('returns each prompt once, best first, with finite scores', () => {
        const index = indexOf(
          prompt('a', { title: 'Deploy', description: 'deploy deploy', body: 'deploy' }),
          prompt('b', { body: 'deploy notes' })
        )
        const results = index.search('deploy')
        expect(results.map((r) => r.id)).toEqual(['a', 'b'])
        expect(results.every((r) => Number.isFinite(r.score))).toBe(true)
        const scores = results.map((r) => r.score)
        expect(scores).toEqual([...scores].sort((x, y) => y - x))
      })

      it('weights fields: title, then tags, then description, then body', () => {
        const filler = { title: 'zzz', description: 'yyy', body: 'xxx' }
        const byWeight = [
          prompt('in-title', { ...filler, title: 'kubernetes' }),
          prompt('in-tags', { ...filler, tags: ['kubernetes'] }),
          prompt('in-description', { ...filler, description: 'kubernetes' }),
          prompt('in-body', { ...filler, body: 'kubernetes' })
        ]
        const expected = ['in-title', 'in-tags', 'in-description', 'in-body']
        // Either insertion order must give the same ranking, so a tie can't pass by luck.
        expect(ids(indexOf(...byWeight), 'kubernetes')).toEqual(expected)
        expect(ids(indexOf(...[...byWeight].reverse()), 'kubernetes')).toEqual(expected)
      })

      it.each([
        ['title', 'description', 4],
        ['tags', 'body', 8],
        ['title', 'body', 8]
      ] as const)(
        'ranks one mention in %s above %s repeating the term %i times',
        (high, low, times) => {
          const filler = { title: 'zzz', description: 'yyy', body: 'xxx' }
          const mention = (
            field: typeof high | typeof low,
            count: number
          ): Partial<IndexedPrompt> => {
            const words = Array<string>(count).fill('kubernetes')
            return field === 'tags' ? { tags: words } : { [field]: words.join(' ') }
          }
          const strong = prompt('strong', { ...filler, ...mention(high, 1) })
          const repeated = prompt('repeated', { ...filler, ...mention(low, times) })
          expect(ids(indexOf(strong, repeated), 'kubernetes')).toEqual(['strong', 'repeated'])
          expect(ids(indexOf(repeated, strong), 'kubernetes')).toEqual(['strong', 'repeated'])
        }
      )
    })

    describe('typo tolerance', () => {
      it('finds prompts despite a single-letter typo', () => {
        const index = indexOf(
          prompt('sum', { title: 'Summarize' }),
          prompt('rev', { title: 'Code review' })
        )
        expect(ids(index, 'sumarize')).toEqual(['sum']) // missing letter
        expect(ids(index, 'summarise')).toEqual(['sum']) // wrong letter
        expect(ids(index, 'reviiew')).toEqual(['rev']) // extra letter
      })

      it('does not match unrelated words', () => {
        const index = indexOf(prompt('a', { title: 'Summarize' }))
        expect(ids(index, 'zebra')).toEqual([])
      })
    })

    describe('aliases', () => {
      it('ranks an exact alias match first, ahead of better text matches', () => {
        const index = indexOf(
          prompt('cron', { title: 'cr cr cr', description: 'cr', tags: ['cr'], body: 'cr cr' }),
          prompt('review', { title: 'Code review', aliases: ['cr', 'review'] }),
          prompt('crud', { title: 'CRUD endpoints' })
        )
        const results = ids(index, 'cr')
        expect(results[0]).toBe('review')
        expect(results).toContain('cron')
      })

      it('ignores case and surrounding whitespace in the alias query', () => {
        const index = indexOf(
          prompt('other', { title: 'CR notes' }),
          prompt('review', { title: 'Code review', aliases: ['cr'] })
        )
        expect(ids(index, '  CR ')[0]).toBe('review')
      })

      it('does not force a prompt first for a mere prefix of its alias', () => {
        const index = indexOf(
          prompt('other', { title: 'C notes' }),
          prompt('review', { title: 'Code review', aliases: ['cr'] })
        )
        expect(ids(index, 'c')[0]).toBe('other')
      })

      it('puts every prompt sharing an alias ahead of other matches', () => {
        const index = indexOf(
          prompt('plain', { title: 'xx xx xx', body: 'xx' }),
          prompt('one', { title: 'One', aliases: ['xx'] }),
          prompt('two', { title: 'Two', aliases: ['xx'] })
        )
        const results = ids(index, 'xx')
        expect(results.slice(0, 2).sort()).toEqual(['one', 'two'])
        expect(results[2]).toBe('plain')
      })

      it('lists an alias match once, even when it also matches by text', () => {
        const index = indexOf(prompt('a', { title: 'cr', aliases: ['cr'] }))
        expect(ids(index, 'cr')).toEqual(['a'])
      })

      it('finds a prompt by an alias that is not its own word', () => {
        const index = indexOf(prompt('a', { title: 'Code review', aliases: ['pr-check'] }))
        expect(ids(index, 'pr-check')).toEqual(['a'])
      })
    })

    describe('update', () => {
      it('replaces the old text and aliases with the new ones', () => {
        const index = indexOf(
          prompt('a', { title: 'Alpha', aliases: ['old'], body: 'oldterm' }),
          prompt('b', { title: 'Beta old' })
        )
        index.update(prompt('a', { title: 'Gamma', aliases: ['new'], body: 'newterm' }))
        expect(ids(index, 'alpha')).toEqual([])
        expect(ids(index, 'oldterm')).toEqual([])
        expect(ids(index, 'old')).toEqual(['b'])
        expect(ids(index, 'gamma')).toEqual(['a'])
        expect(ids(index, 'newterm')).toEqual(['a'])
        expect(ids(index, 'new')[0]).toBe('a')
      })

      it('adds a prompt that was not indexed yet', () => {
        const index = indexOf(prompt('a', { title: 'Alpha' }))
        index.update(prompt('b', { title: 'Bravo' }))
        expect(ids(index, 'bravo')).toEqual(['b'])
        expect(ids(index, 'alpha')).toEqual(['a'])
      })

      it('works on an index that was never built', () => {
        const index = create()
        index.update(prompt('a', { title: 'Alpha' }))
        expect(ids(index, 'alpha')).toEqual(['a'])
      })

      it('keeps a prompt searchable after many updates', () => {
        const index = indexOf(prompt('a', { title: 'Alpha 0' }))
        for (let i = 1; i <= 100; i++) index.update(prompt('a', { title: `Alpha ${i}` }))
        expect(ids(index, 'alpha')).toEqual(['a'])
        expect(ids(index, '100')).toEqual(['a'])
        expect(ids(index, '99')).toEqual([])
      })
    })

    describe('remove', () => {
      it('stops returning a removed prompt', () => {
        const index = indexOf(
          prompt('a', { title: 'Alpha', aliases: ['al'] }),
          prompt('b', { title: 'Alpha two' })
        )
        index.remove('a')
        expect(ids(index, 'alpha')).toEqual(['b'])
        expect(ids(index, 'al')).toEqual(['b'])
      })

      it('ignores unknown ids', () => {
        const index = indexOf(prompt('a', { title: 'Alpha' }))
        expect(() => index.remove('nope')).not.toThrow()
        expect(() => create().remove('nope')).not.toThrow()
        expect(ids(index, 'alpha')).toEqual(['a'])
      })

      it('lets a removed id be added again', () => {
        const index = indexOf(prompt('a', { title: 'Alpha' }))
        index.remove('a')
        index.remove('a')
        index.update(prompt('a', { title: 'Alpha again' }))
        expect(ids(index, 'again')).toEqual(['a'])
      })
    })

    describe('index (rebuild)', () => {
      it('discards everything indexed before', () => {
        const index = indexOf(prompt('old', { title: 'Old thing', aliases: ['ot'] }))
        index.index([prompt('new', { title: 'New thing' })])
        expect(ids(index, 'thing')).toEqual(['new'])
        expect(ids(index, 'ot')).toEqual([])
      })

      it('accepts an empty list', () => {
        const index = indexOf(prompt('a', { title: 'Alpha' }))
        index.index([])
        expect(ids(index, 'alpha')).toEqual([])
      })

      it('treats a repeated id as one prompt, the last one winning', () => {
        const index = indexOf(prompt('a', { title: 'First' }), prompt('a', { title: 'Second' }))
        expect(ids(index, 'first')).toEqual([])
        expect(ids(index, 'second')).toEqual(['a'])
      })
    })

    describe('limit', () => {
      it('caps the number of results', () => {
        const many = Array.from({ length: 30 }, (_, i) => prompt(`p${i}`, { title: 'common' }))
        const index = indexOf(...many)
        expect(ids(index, 'common', 5)).toHaveLength(5)
        expect(ids(index, 'common', 100)).toHaveLength(30)
      })

      it('applies the limit after putting alias matches first', () => {
        const many = Array.from({ length: 10 }, (_, i) => prompt(`p${i}`, { title: 'go go go' }))
        const index = indexOf(...many, prompt('target', { title: 'Zebra', aliases: ['go'] }))
        expect(ids(index, 'go', 1)).toEqual(['target'])
      })
    })

    describe('unicode', () => {
      it('ignores accents in both directions', () => {
        const index = indexOf(
          prompt('cv', { title: 'Résumé review' }),
          prompt('plain', { title: 'Cafe menu' })
        )
        expect(ids(index, 'resume')).toEqual(['cv'])
        expect(ids(index, 'RÉSUMÉ')).toEqual(['cv'])
        expect(ids(index, 'café')).toEqual(['plain'])
      })

      it('handles non-Latin scripts', () => {
        const index = indexOf(
          prompt('ru', { title: 'Привет мир' }),
          prompt('ja', { title: '日本語のプロンプト' }),
          prompt('ar', { title: 'مراجعة الكود' })
        )
        expect(ids(index, 'ПРИВЕТ')).toEqual(['ru'])
        expect(ids(index, 'мир')).toEqual(['ru'])
        expect(ids(index, '日本語')).toEqual(['ja'])
        expect(ids(index, 'مراجعة')).toEqual(['ar'])
      })

      it('handles emoji and decomposed characters', () => {
        const index = indexOf(
          prompt('rocket', { title: '🚀 Launch checklist' }),
          prompt('combining', { title: 'Café notes' })
        )
        expect(ids(index, 'launch')).toEqual(['rocket'])
        expect(ids(index, 'café')).toEqual(['combining'])
        expect(ids(index, '🚀')).toEqual(['rocket'])
      })

      it('matches aliases with accents or other scripts', () => {
        const index = indexOf(
          prompt('a', { title: 'A', aliases: ['résumé'] }),
          prompt('b', { title: 'B', aliases: ['ревью'] })
        )
        expect(ids(index, 'resume')[0]).toBe('a')
        expect(ids(index, 'РЕВЬЮ')[0]).toBe('b')
      })
    })

    describe('odd input', () => {
      it('never throws on punctuation, regex characters or very long queries', () => {
        const index = indexOf(prompt('a', { title: 'Alpha (beta) [gamma] *delta*' }))
        for (const query of [
          '(',
          '[',
          ')',
          '\\',
          '*',
          '.*',
          '{{if',
          '"',
          "'",
          '\u0000',
          'a'.repeat(10_000)
        ]) {
          expect(() => index.search(query)).not.toThrow()
        }
        expect(ids(index, '(beta)')).toEqual(['a'])
      })

      it('copes with prompts that have empty or odd fields', () => {
        const index = indexOf(
          prompt('blank', { title: '' }),
          prompt('spacey', { title: '  ', aliases: ['', '  '], tags: [''] })
        )
        expect(ids(index, 'blank')).toEqual([])
        expect(ids(index, '')).toEqual([])
      })
    })
  })
}
