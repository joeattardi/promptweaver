import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface StarterPrompt {
  /** Path inside the library folder. */
  path: string
  content: string
}

// A small set to get started with. Phase 6 adds the full starter pack.
export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    path: 'code/code-review.md',
    content: `---
title: Code Review
description: Review a code change for bugs, readability, and risk
tags: [code, review]
aliases: [cr, review]
format: 1
fields:
  language: { type: select, options: [TypeScript, Python, Go, Rust] }
  focus:
    type: multiselect
    options: [Bugs, Performance, Readability, Security, Tests]
    default: [Bugs, Readability]
  tone:
    type: select
    options:
      Gentle: Be encouraging and suggest improvements diplomatically.
      Blunt: Be direct. Skip praise and list problems in priority order.
  context: { type: textarea, help: What does this change do? }
  code: { type: textarea, required: true, from: clipboard }
---
You are a senior {{language}} engineer reviewing a pull request.

{{if focus}}
Focus on: {{focus}}.
{{end}}
{{tone}}

{{if context}}
## Context
{{context}}
{{end}}

## Code
{{code}}

{{if focus has Security}}
Flag anything that touches user input, auth, or secrets.
{{end}}
`
  },
  {
    path: 'code/explain-code.md',
    content: `---
title: Explain Code
description: Explain a piece of code at the level you need
tags: [code, learning]
aliases: [ex]
format: 1
fields:
  level:
    type: select
    options:
      Beginner: Assume I am new to programming. Avoid jargon and explain every term you use.
      Intermediate: Assume I know the basics. Focus on why it works this way.
      Expert: Be concise. Skip the basics and point out subtle details and trade-offs.
  language: { type: text, help: Leave blank if it is obvious from the code }
  walkthrough: { type: toggle, label: Walk through it line by line }
  code: { type: textarea, required: true, from: clipboard }
---
Explain the following {{if language}}{{language}} {{end}}code.

{{level}}

{{if walkthrough}}
Go through it step by step, quoting each part before you explain it.
{{else}}
Give a short overview first, then cover the important details.
{{end}}

## Code
{{code}}
`
  },
  {
    path: 'writing/reply-to-email.md',
    content: `---
title: Reply to Email
description: Draft a reply to the email on your clipboard
tags: [email, writing]
aliases: [re]
format: 1
fields:
  tone:
    type: select
    options:
      Warm: Write in a warm, friendly tone.
      Formal: Write in a formal, professional tone. Avoid contractions.
      Brief: Keep it to three sentences or fewer.
  decline: { type: toggle, label: Politely decline }
  name: { type: text, label: Your name, required: true }
---
Today is {{date}}. Draft a reply to the email below, written as {{name}}.

{{tone}}
{{if decline}}
Politely decline the request and suggest an alternative if one makes sense.
{{else}}
Agree to the request and confirm the next steps.
{{end}}

{{if clipboard}}
## Email
{{clipboard}}
{{else}}
(I will paste the email in my next message.)
{{end}}
`
  },
  {
    path: 'writing/summarize.md',
    content: `---
title: Summarize
description: Summarize text at the length and style you choose
tags: [writing, summary]
aliases: [sum]
format: 1
fields:
  style:
    type: select
    options:
      Bullet points: Use a bulleted list.
      Paragraph: Write a single paragraph.
      One sentence: Write exactly one sentence.
  max_words: { type: number, label: Maximum words, min: 10, max: 1000, default: 100 }
  audience: { type: text, help: Who is this for? }
  text: { type: textarea, required: true, from: clipboard }
---
Summarize the text below in no more than {{max_words}} words. {{style}}
{{if audience}}
Write it for: {{audience}}.
{{end}}

## Text
{{text}}
`
  },
  {
    path: 'meeting-notes.md',
    content: `---
title: Meeting Notes to Action Items
description: Turn raw meeting notes into decisions and action items
tags: [work, meetings]
aliases: [mn]
format: 1
fields:
  attendees: { type: text, help: Optional. Comma-separated names }
  include_summary: { type: toggle, label: Include a short summary, default: true }
  notes: { type: textarea, required: true, from: clipboard }
---
These are my notes from a meeting on {{date}}.
{{if attendees}}
Attendees: {{attendees}}.
{{end}}

Extract:
1. Decisions that were made.
2. Action items, each with an owner and a due date if one was mentioned.
3. Open questions.
{{if include_summary}}
Start with a two-sentence summary.
{{end}}

## Notes
{{notes}}
`
  }
]

export interface WriteStartersResult {
  created: string[]
  /** Starters whose file already exists. They are left exactly as they are. */
  skipped: string[]
}

/**
 * Writes the starter prompts into `root`. Never overwrites: a file that
 * already exists (edited or not) is skipped. (Creating with the exclusive
 * `wx` flag means there is no existing data to lose if a write is cut short.)
 */
export async function writeStarters(root: string): Promise<WriteStartersResult> {
  const created: string[] = []
  const skipped: string[] = []
  for (const starter of STARTER_PROMPTS) {
    const path = join(root, starter.path)
    await mkdir(dirname(path), { recursive: true })
    try {
      await writeFile(path, starter.content, { flag: 'wx' })
      created.push(starter.path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        skipped.push(starter.path)
      } else {
        throw error
      }
    }
  }
  return { created, skipped }
}
