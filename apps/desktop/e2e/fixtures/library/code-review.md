---
title: Code Review
description: Review a code change for bugs and risk
tags: [code, review]
aliases: [cr]
fields:
  language: { type: select, options: [TypeScript, Python, Go] }
  focus:
    type: multiselect
    options: [Bugs, Performance, Security]
    default: [Bugs]
  tone:
    type: select
    options:
      Gentle: Be encouraging.
      Blunt: Be direct.
  strict: { type: toggle }
  count: { type: number, min: 1, max: 5 }
  code: { type: textarea, required: true, from: clipboard, help: The change to review }
---
You are a {{language}} reviewer. {{tone}}
{{if focus}}
Focus on: {{focus}}.
{{end}}
{{if strict}}
Be strict.
{{end}}
Count: {{count}}
{{code}}
