import { readFileSync } from 'node:fs'
import { parse, type ParsedPrompt } from './parse'
import type { TextChange } from './types'

export type FixtureName = 'code-review' | 'email-reply'

export function fixtureText(name: FixtureName): string {
  return readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), 'utf8')
}

export function fixture(name: FixtureName): ParsedPrompt {
  return parse(fixtureText(name))
}

/** Applies non-overlapping changes made against `text`. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  const sorted = [...changes].sort((a, b) => b.from - a.from || b.to - a.to)
  for (let i = 1; i < sorted.length; i++) {
    const later = sorted[i - 1]
    const earlier = sorted[i]
    if (later && earlier && earlier.to > later.from) throw new Error('overlapping changes')
  }
  return sorted.reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)
}
