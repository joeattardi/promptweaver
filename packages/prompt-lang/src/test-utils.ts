import { readFileSync } from 'node:fs'
import { parse, type ParsedPrompt } from './parse'

export type FixtureName = 'code-review' | 'email-reply'

export function fixtureText(name: FixtureName): string {
  return readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), 'utf8')
}

export function fixture(name: FixtureName): ParsedPrompt {
  return parse(fixtureText(name))
}
