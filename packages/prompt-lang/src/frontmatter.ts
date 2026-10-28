import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node as YamlNode,
  type Pair,
  type YAMLMap
} from 'yaml'
import { z } from 'zod'
import { humanizeId, isFieldId } from './text'
import { FIELD_TYPES, type Diagnostic, type FieldType, type Range } from './types'

export interface FrontmatterBlock {
  /** From the opening `---` to just past the closing delimiter line. */
  range: Range
  /** The YAML source between the delimiters. */
  content: Range
}

export interface SplitResult {
  block: FrontmatterBlock | null
  bodyStart: number
  diagnostics: Diagnostic[]
}

const OPEN = /^(\uFEFF?)---[ \t]*\r?\n/
const CLOSE = /^---[ \t]*\r?$/

/** Splits the leading `---` frontmatter block from the body. Never throws. */
export function splitFrontmatter(text: string): SplitResult {
  const bomLength = text.startsWith('\uFEFF') ? 1 : 0
  const open = OPEN.exec(text)
  if (open === null) return { block: null, bodyStart: bomLength, diagnostics: [] }

  const contentFrom = open[0].length
  let pos = contentFrom
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos)
    const lineEnd = nl === -1 ? text.length : nl
    if (CLOSE.test(text.slice(pos, lineEnd))) {
      const end = nl === -1 ? text.length : nl + 1
      return {
        block: { range: { from: bomLength, to: end }, content: { from: contentFrom, to: pos } },
        bodyStart: end,
        diagnostics: []
      }
    }
    if (nl === -1) break
    pos = nl + 1
  }

  return {
    block: null,
    bodyStart: bomLength,
    diagnostics: [
      {
        severity: 'error',
        code: 'invalid-frontmatter',
        message: 'Frontmatter is missing its closing --- line.',
        range: { from: bomLength, to: bomLength + 3 }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Typed frontmatter

export interface Option {
  label: string
  /** Inserted text. Same as `label` unless options is a label-to-value map. */
  value: string
  labelRange: Range
}

interface FieldCommon {
  id: string
  idRange: Range
  /** The whole `id: definition` entry. */
  range: Range
  /** Effective label: explicit `label`, or the humanized id. */
  label: string
  help?: string
  required: boolean
}

export type FieldDef =
  | (FieldCommon & { type: 'text' | 'textarea'; default?: string; from?: 'clipboard' })
  | (FieldCommon & { type: 'select'; options: Option[]; default?: string })
  | (FieldCommon & { type: 'multiselect'; options: Option[]; default?: string[]; join: string })
  | (FieldCommon & { type: 'toggle'; default?: boolean })
  | (FieldCommon & { type: 'number'; default?: number; min?: number; max?: number })

export interface Alias {
  value: string
  range: Range
}

export interface Frontmatter {
  range: Range
  contentRange: Range
  /** The YAML document, kept for comment- and order-preserving edits. Ranges are relative to `contentRange.from`. */
  document: Document.Parsed
  title?: string
  description?: string
  tags: string[]
  aliases: Alias[]
  format?: number
  fields: FieldDef[]
}

export const DEFAULT_JOIN = ', '

const scalarText = z.union([z.string(), z.number(), z.boolean()]).transform(String)
const textList = z.array(scalarText)

const TOP_LEVEL = {
  title: { schema: scalarText.refine((s) => s.trim() !== ''), expected: 'non-empty text' },
  description: { schema: scalarText, expected: 'text' },
  tags: { schema: textList, expected: 'a list of text' },
  aliases: { schema: textList, expected: 'a list of text' },
  format: { schema: z.literal(1), expected: 'the number 1 (the only supported format)' }
} as const

interface KeySpec {
  schema: z.ZodType
  expected: string
}

const COMMON_KEYS: Record<string, KeySpec> = {
  type: { schema: z.string(), expected: 'a field type' },
  label: { schema: scalarText, expected: 'text' },
  help: { schema: scalarText, expected: 'text' },
  required: { schema: z.boolean(), expected: 'true or false' }
}

const OPTIONS_KEY: KeySpec = { schema: z.unknown(), expected: 'a list or a map of label: text' }

const TYPE_KEYS: Record<FieldType, Record<string, KeySpec>> = {
  text: {
    default: { schema: scalarText, expected: 'text' },
    from: { schema: z.literal('clipboard'), expected: 'clipboard' }
  },
  textarea: {
    default: { schema: scalarText, expected: 'text' },
    from: { schema: z.literal('clipboard'), expected: 'clipboard' }
  },
  select: { options: OPTIONS_KEY, default: { schema: scalarText, expected: 'one option label' } },
  multiselect: {
    options: OPTIONS_KEY,
    default: { schema: textList, expected: 'a list of option labels' },
    join: { schema: z.string(), expected: 'text' }
  },
  toggle: { default: { schema: z.boolean(), expected: 'true or false' } },
  number: {
    default: { schema: z.number(), expected: 'a number' },
    min: { schema: z.number(), expected: 'a number' },
    max: { schema: z.number(), expected: 'a number' }
  }
}

/** Keys allowed in a field definition of the given type. */
export function allowedFieldKeys(type: FieldType): string[] {
  return [...Object.keys(COMMON_KEYS), ...Object.keys(TYPE_KEYS[type])]
}

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value)
}

function isEmptyNode(node: YamlNode | null): boolean {
  return node === null || (isScalar(node) && node.value === null)
}

interface Entry {
  key: string
  keyNode: YamlNode
  value: YamlNode | null
}

class FrontmatterParser {
  readonly diagnostics: Diagnostic[] = []

  constructor(
    private readonly doc: Document.Parsed,
    private readonly base: number,
    private readonly block: FrontmatterBlock
  ) {}

  range(node: YamlNode | null | undefined, fallback?: Range): Range {
    if (node?.range) return { from: this.base + node.range[0], to: this.base + node.range[1] }
    return fallback ?? { from: this.block.range.from, to: this.block.range.from + 3 }
  }

  error(code: Diagnostic['code'], message: string, range: Range): void {
    this.diagnostics.push({ severity: 'error', code, message, range })
  }

  toJS(node: YamlNode | null): unknown {
    return node === null ? null : node.toJS(this.doc)
  }

  /** First occurrence of each string key; reports duplicates and non-text keys. */
  entries(map: YAMLMap, where: string): Map<string, Entry> {
    const result = new Map<string, Entry>()
    for (const pair of map.items as Pair<YamlNode, YamlNode | null>[]) {
      const keyNode = pair.key
      if (!isScalar(keyNode) || keyNode.value === null || typeof keyNode.value === 'object') {
        this.error('invalid-frontmatter', `Keys ${where} must be text.`, this.range(keyNode))
        continue
      }
      const key = String(keyNode.value)
      if (result.has(key)) {
        this.error('invalid-frontmatter', `Duplicate key "${key}" ${where}.`, this.range(keyNode))
        continue
      }
      result.set(key, { key, keyNode, value: pair.value })
    }
    return result
  }

  check<T>(
    entry: Entry,
    spec: { schema: z.ZodType<T>; expected: string },
    label: string
  ): T | undefined {
    const parsed = spec.schema.safeParse(this.toJS(entry.value))
    if (parsed.success) return parsed.data
    this.error(
      'invalid-frontmatter',
      `${label} must be ${spec.expected}.`,
      this.range(entry.value, this.range(entry.keyNode))
    )
    return undefined
  }

  parse(): Frontmatter {
    const fm: Frontmatter = {
      range: this.block.range,
      contentRange: this.block.content,
      document: this.doc,
      tags: [],
      aliases: [],
      fields: []
    }

    for (const e of this.doc.errors) {
      this.error('yaml-syntax', e.message, {
        from: this.base + e.pos[0],
        to: this.base + Math.max(e.pos[1], e.pos[0] + 1)
      })
    }
    if (this.doc.errors.length > 0) return fm

    const root = this.doc.contents
    if (root !== null && !isMap(root)) {
      this.error(
        'invalid-frontmatter',
        'Frontmatter must be a set of key: value pairs.',
        this.range(root)
      )
      return fm
    }
    const top = root === null ? new Map<string, Entry>() : this.entries(root, 'in frontmatter')

    const title = top.get('title')
    if (title === undefined) {
      this.error('invalid-frontmatter', 'Frontmatter needs a title.', this.range(null))
    } else {
      fm.title = this.check(title, TOP_LEVEL.title, '"title"')
    }
    const description = top.get('description')
    if (description)
      fm.description = this.check(description, TOP_LEVEL.description, '"description"')
    const tags = top.get('tags')
    if (tags) fm.tags = this.check(tags, TOP_LEVEL.tags, '"tags"') ?? []
    const aliases = top.get('aliases')
    if (aliases) {
      const values = this.check(aliases, TOP_LEVEL.aliases, '"aliases"')
      const items = isSeq(aliases.value) ? (aliases.value.items as YamlNode[]) : []
      if (values !== undefined) {
        fm.aliases = values.map((value, i) => ({ value, range: this.range(items[i]) }))
      }
    }
    const format = top.get('format')
    if (format) fm.format = this.check(format, TOP_LEVEL.format, '"format"')

    const fields = top.get('fields')
    if (fields && !isEmptyNode(fields.value)) {
      if (isMap(fields.value)) {
        fm.fields = this.parseFields(fields.value)
      } else {
        this.error(
          'invalid-frontmatter',
          '"fields" must be a map of field id to definition.',
          this.range(fields.value)
        )
      }
    }
    return fm
  }

  parseFields(map: YAMLMap): FieldDef[] {
    const fields: FieldDef[] = []
    const seen = new Set<string>()
    for (const pair of map.items as Pair<YamlNode, YamlNode | null>[]) {
      const keyNode = pair.key
      const id = isScalar(keyNode) ? String(keyNode.value) : ''
      const idRange = this.range(keyNode)
      if (!isScalar(keyNode) || !isFieldId(id)) {
        this.error(
          'invalid-field-id',
          `"${id}" is not a valid field id. Use letters, digits and underscores, starting with a letter.`,
          idRange
        )
        continue
      }
      if (seen.has(id)) {
        this.error('duplicate-field-id', `Field "${id}" is declared more than once.`, idRange)
        continue
      }
      seen.add(id)
      const range = { from: idRange.from, to: this.range(pair.value, idRange).to }
      fields.push(this.parseField(id, idRange, range, pair.value))
    }
    return fields
  }

  parseField(id: string, idRange: Range, range: Range, node: YamlNode | null): FieldDef {
    const fallback = (entries?: Map<string, Entry>): FieldDef => {
      // Falls back to a text field, keeping whichever common keys are valid so
      // the form still looks reasonable. The cause is already reported.
      const quiet = <T>(key: string, schema: z.ZodType<T>): T | undefined => {
        const entry = entries?.get(key)
        const parsed = entry ? schema.safeParse(this.toJS(entry.value)) : undefined
        return parsed?.success ? parsed.data : undefined
      }
      const field: FieldDef = {
        type: 'text',
        id,
        idRange,
        range,
        label: quiet('label', scalarText) ?? humanizeId(id),
        required: quiet('required', z.boolean()) ?? false
      }
      const help = quiet('help', scalarText)
      if (help !== undefined) field.help = help
      return field
    }

    if (!isMap(node)) {
      this.error(
        'invalid-frontmatter',
        `Field "${id}" must be a definition like { type: text }.`,
        this.range(node, idRange)
      )
      return fallback()
    }

    const entries = this.entries(node, `in field "${id}"`)
    const typeEntry = entries.get('type')
    if (typeEntry === undefined) {
      this.error('invalid-frontmatter', `Field "${id}" needs a type.`, idRange)
      return fallback(entries)
    }
    const type = this.toJS(typeEntry.value)
    if (!isFieldType(type)) {
      this.error(
        'unknown-field-type',
        `Unknown field type "${String(type)}". Use one of: ${FIELD_TYPES.join(', ')}.`,
        this.range(typeEntry.value, this.range(typeEntry.keyNode))
      )
      return fallback(entries)
    }

    const specs: Record<string, KeySpec> = { ...COMMON_KEYS, ...TYPE_KEYS[type] }
    const values: Record<string, unknown> = {}
    for (const entry of entries.values()) {
      const spec = specs[entry.key]
      if (spec === undefined) {
        this.error(
          'invalid-frontmatter',
          `"${entry.key}" is not a valid key for a ${type} field. Valid keys: ${allowedFieldKeys(type).join(', ')}.`,
          this.range(entry.keyNode)
        )
        continue
      }
      if (entry.key === 'options') {
        values['options'] = this.parseOptions(entry, id)
        continue
      }
      const value = this.check(entry, spec, `"${entry.key}"`)
      if (value !== undefined) values[entry.key] = value
    }

    const common: FieldCommon = {
      id,
      idRange,
      range,
      label: (values['label'] as string | undefined) ?? humanizeId(id),
      required: (values['required'] as boolean | undefined) ?? false
    }
    if (values['help'] !== undefined) common.help = values['help'] as string

    switch (type) {
      case 'text':
      case 'textarea': {
        const field: FieldDef = { ...common, type }
        if (values['default'] !== undefined) field.default = values['default'] as string
        if (values['from'] !== undefined) field.from = 'clipboard'
        return field
      }
      case 'select':
      case 'multiselect': {
        const options = (values['options'] as Option[] | undefined) ?? []
        if (!entries.has('options')) {
          this.error('invalid-frontmatter', `A ${type} field needs options.`, idRange)
        }
        const labels = new Set(options.map((o) => o.label))
        const defaultEntry = entries.get('default')
        const defaultRange = this.range(defaultEntry?.value, idRange)
        if (type === 'select') {
          const field: FieldDef = { ...common, type, options }
          const def = values['default'] as string | undefined
          if (def !== undefined && options.length > 0 && !labels.has(def)) {
            this.error(
              'invalid-frontmatter',
              `Default "${def}" is not one of the options.`,
              defaultRange
            )
          } else if (def !== undefined) {
            field.default = def
          }
          return field
        }
        const field: FieldDef = {
          ...common,
          type,
          options,
          join: (values['join'] as string | undefined) ?? DEFAULT_JOIN
        }
        const def = values['default'] as string[] | undefined
        if (def !== undefined) {
          const unknown = def.filter((d) => !labels.has(d))
          if (unknown.length > 0 && options.length > 0) {
            this.error(
              'invalid-frontmatter',
              `Default ${unknown.map((u) => `"${u}"`).join(', ')} not among the options.`,
              defaultRange
            )
          }
          field.default = def.filter((d) => labels.has(d))
        }
        return field
      }
      case 'toggle': {
        const field: FieldDef = { ...common, type }
        if (values['default'] !== undefined) field.default = values['default'] as boolean
        return field
      }
      case 'number': {
        const field: FieldDef = { ...common, type }
        const min = values['min'] as number | undefined
        const max = values['max'] as number | undefined
        const def = values['default'] as number | undefined
        if (min !== undefined) field.min = min
        if (max !== undefined) field.max = max
        if (min !== undefined && max !== undefined && min > max) {
          this.error('invalid-frontmatter', '"min" is greater than "max".', idRange)
        }
        if (def !== undefined) {
          if ((min !== undefined && def < min) || (max !== undefined && def > max)) {
            this.error(
              'invalid-frontmatter',
              `Default ${def} is outside the allowed range.`,
              this.range(entries.get('default')?.value, idRange)
            )
          } else {
            field.default = def
          }
        }
        return field
      }
    }
  }

  parseOptions(entry: Entry, id: string): Option[] {
    const node = entry.value
    const options: Option[] = []
    const scalarString = (n: YamlNode | null): string | null => {
      if (n === null) return ''
      if (!isScalar(n)) return null
      const v = n.value
      if (v === null) return ''
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : null
    }

    if (isSeq(node)) {
      for (const item of node.items as (YamlNode | null)[]) {
        const label = item === null ? null : scalarString(item)
        if (label === null || item === null) {
          this.error(
            'invalid-frontmatter',
            'Each option must be text.',
            this.range(item, this.range(node))
          )
          continue
        }
        options.push({ label, value: label, labelRange: this.range(item) })
      }
    } else if (isMap(node)) {
      for (const pair of node.items as Pair<YamlNode, YamlNode | null>[]) {
        const label = scalarString(pair.key)
        const value = scalarString(pair.value)
        if (label === null || value === null) {
          this.error(
            'invalid-frontmatter',
            'Options must map a label to the text to insert.',
            this.range(pair.key)
          )
          continue
        }
        options.push({ label, value, labelRange: this.range(pair.key) })
      }
    } else {
      this.error(
        'invalid-frontmatter',
        `"options" of field "${id}" must be ${OPTIONS_KEY.expected}.`,
        this.range(node, this.range(entry.keyNode))
      )
      return options
    }

    if (options.length === 0) {
      this.error(
        'invalid-frontmatter',
        `Field "${id}" needs at least one option.`,
        this.range(node)
      )
    }
    return options
  }
}

/** Parses the YAML frontmatter block into typed values. Never throws. */
export function parseFrontmatter(
  text: string,
  block: FrontmatterBlock
): { frontmatter: Frontmatter; diagnostics: Diagnostic[] } {
  const source = text.slice(block.content.from, block.content.to)
  const doc = parseDocument(source, { uniqueKeys: false, prettyErrors: false })
  const parser = new FrontmatterParser(doc, block.content.from, block)
  const frontmatter = parser.parse()
  return { frontmatter, diagnostics: parser.diagnostics }
}
