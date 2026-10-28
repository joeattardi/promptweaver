import { z } from 'zod'
import type { Values } from 'prompt-lang'

const MAX_TEXT = 2_000_000

const FieldValueSchema = z.union([
  z.string().max(MAX_TEXT),
  z.array(z.string().max(1000)).max(1000),
  z.boolean(),
  z.number().finite(),
  z.null()
])

/** Values keyed by field id, as sent by a window or kept in the state file. */
export const ValuesSchema: z.ZodType<Values> = z.record(z.string().max(200), FieldValueSchema)
