---
name: openai-image
description: Generate or edit images through the official OpenAI API using an OpenAI API key, with clear billing and ChatGPT-plan boundaries.
allowed-tools:
  - Bash
  - Read
---

# OpenAI API image generation

Use this skill when the user wants image generation or editing through the OpenAI API from the toolkit. This is an API-key path, not a ChatGPT-plan or Codex App Server entitlement path.

## Boundaries

- Do not claim ChatGPT Plus, Pro, Team, or Codex App Server includes API image credits.
- Do not use a ChatGPT OAuth token, Codex token, Claude token, or MCP token for image generation.
- Require `OPENAI_API_KEY` in the environment or ask the user to configure it outside the chat.
- Before making a live API request, tell the user it may bill their OpenAI API project and get explicit approval.
- Keep outputs inside the current project unless the user gives another path. Prefer `generated/images/` or another ignored/project-safe output directory.
- Do not print API keys, bearer tokens, or response bodies that may contain sensitive data.

## Supported path

Use official OpenAI API image generation or editing endpoints/tools with GPT Image models. Prefer the current official OpenAI docs if the exact model, endpoint shape, or option set matters.

Reasonable defaults when the user does not specify them:

- image model: use the current GPT Image model named in official OpenAI docs; do not assume this file is fresher than the docs
- size: a documented square default such as `1024x1024`, unless the current model uses a different size scheme
- background: `auto`; use `transparent` only when the user asks for transparency or an asset/logo/sticker workflow needs it
- output format: `png` for transparent or editable assets, otherwise `png` unless the user asks for another format

## Workflow

1. Restate the billing/auth boundary in one sentence.
2. Confirm an output path that is safe for the project.
3. Check `OPENAI_API_KEY` without printing it:

```bash
test -n "${OPENAI_API_KEY:-}"
```

4. Make the smallest request that satisfies the user's ask.
5. Save the decoded image file and report the path, model, size, and whether this was generation or editing.
6. If the request fails, report the HTTP status and concise error message. Do not retry blindly.

## Example request shape

Treat this as a shape, not frozen API documentation. Refresh against official OpenAI docs before changing supported parameters or model names.

```bash
mkdir -p generated/images
curl -sS https://api.openai.com/v1/responses   -H "Authorization: Bearer $OPENAI_API_KEY"   -H "Content-Type: application/json"   -d '{
    "model": "<current text model from docs>",
    "input": "Generate a clean product icon on a transparent background",
    "tools": [{
      "type": "image_generation",
      "model": "<current GPT Image model from docs>",
      "background": "transparent"
    }],
    "tool_choice": {"type": "image_generation"}
  }'
```

Decode only the returned `image_generation_call` result needed for the final file. Avoid logging full JSON responses unless debugging requires it and the response contains no sensitive data.
