---
title: Reply to Email
description: Draft a reply to the email on the clipboard
tags: [email, writing]
aliases: [re]
format: 1
fields:
  # How the reply should sound. The form shows the label, the prompt gets the text.
  tone:
    type: select
    options:
      Warm: Write in a warm, friendly tone.
      Formal: Write in a formal, professional tone.
      Brief: Keep it to three sentences or fewer.
  decline: { type: toggle, label: Politely decline }
  signoff: { type: text, default: Best }
---
Today is {{date}}. Draft a reply to the email below for {{sender_name}}.

{{tone}}
{{if decline}}
Politely decline the request and suggest an alternative if one makes sense.
{{else}}
Agree to the request and confirm the next steps.
{{end}}
{{if tone is Formal}}
Avoid contractions.
{{end}}

Sign off with "{{signoff}}, {{sender_name}}".

{{if clipboard}}
## Email
{{clipboard}}
{{else}}
(No email was on the clipboard. Ask me to paste it.)
{{end}}
