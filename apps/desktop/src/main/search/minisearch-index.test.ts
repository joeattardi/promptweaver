import { describe, expect, it } from 'vitest'
import { MiniSearchIndex } from './minisearch-index'
import { prompt, runSearchIndexContract } from './search-index.contract'

runSearchIndexContract('MiniSearchIndex', () => new MiniSearchIndex())

describe('MiniSearchIndex specifics', () => {
  it('requires every word of a multi-word query', () => {
    const index = new MiniSearchIndex()
    index.index([
      prompt('both', { title: 'Code review' }),
      prompt('one', { title: 'Code golf' }),
      prompt('split', { title: 'Review', body: 'check the code' })
    ])
    expect(
      index
        .search('code review')
        .map((r) => r.id)
        .sort()
    ).toEqual(['both', 'split'])
    expect(index.search('code zebra')).toEqual([])
  })

  it('gives alias matches a score above every other result', () => {
    const index = new MiniSearchIndex()
    index.index([
      prompt('text', { title: 'cr cr cr', tags: ['cr'] }),
      prompt('alias', { title: 'Review', aliases: ['cr'] })
    ])
    const [first, second] = index.search('cr')
    expect(first?.id).toBe('alias')
    expect(first && second && first.score > second.score).toBe(true)
  })

  it('is fast enough on a realistic library', () => {
    const words = [
      'review',
      'summarize',
      'email',
      'refactor',
      'explain',
      'translate',
      'draft',
      'plan'
    ]
    const prompts = Array.from({ length: 5000 }, (_, i) =>
      prompt(`folder${i % 20}/prompt-${i}`, {
        title: `${words[i % 8]} ${words[(i * 3) % 8]} ${i}`,
        aliases: [`a${i}`],
        tags: [words[(i * 5) % 8] ?? ''],
        description: `${words[(i * 7) % 8]} the given text with care`,
        body: `You are an expert. ${words.join(' ')} ${'lorem ipsum dolor sit amet '.repeat(40)}`
      })
    )
    const index = new MiniSearchIndex()
    index.index(prompts)

    const queries = ['r', 're', 'rev', 'review', 'sumarize', 'draft email', 'a42', 'explain 99']
    const started = performance.now()
    for (let round = 0; round < 10; round++) for (const q of queries) index.search(q)
    const perSearch = (performance.now() - started) / (10 * queries.length)
    // CLAUDE.md: revisit the engine if a keystroke costs more than ~20 ms.
    expect(perSearch).toBeLessThan(20)
  })
})
