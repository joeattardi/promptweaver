import { readFile, rename } from 'node:fs/promises'
import type { z } from 'zod'
import { writeFileAtomic } from './atomic-write'

/**
 * A small JSON file validated by a Zod schema. A missing file gives the
 * defaults. A file that can't be read as valid JSON of the right shape is moved
 * aside (never overwritten or deleted) and the defaults are used instead.
 */
export class JsonStore<T> {
  constructor(
    private readonly path: string,
    private readonly schema: z.ZodType<T>,
    private readonly defaults: () => T
  ) {}

  async load(): Promise<T> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isMissing(error)) return this.defaults()
      throw error
    }
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return this.quarantine('is not valid JSON')
    }
    const parsed = this.schema.safeParse(json)
    return parsed.success ? parsed.data : this.quarantine('has an unexpected shape')
  }

  save(value: T): Promise<void> {
    return writeFileAtomic(this.path, `${JSON.stringify(value, null, 2)}\n`)
  }

  private async quarantine(reason: string): Promise<T> {
    const moved = `${this.path}.invalid-${Date.now()}`
    await rename(this.path, moved)
    console.warn(`${this.path} ${reason}; moved it to ${moved} and using defaults.`)
    return this.defaults()
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
