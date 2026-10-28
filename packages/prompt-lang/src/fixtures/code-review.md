---
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
