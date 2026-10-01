---
name: openai-image
description: Generate/edit images via Codex ImageGen.
allowed-tools:
  - Bash
  - Read
---

# Codex native image generation

Use this skill when the user wants image generation or editing from Codex. Prefer the host-native ImageGen tool when it is available. Do not require an OpenAI API key for the native Codex path.

## Boundaries

- First choice: native ImageGen / `$imagegen` / `image_gen` exposed by the current Codex or ChatGPT host.
- Do not claim ChatGPT Plus, Pro, Team, or Codex App Server includes OpenAI API image credits.
- Do not use a ChatGPT OAuth token, Codex token, Claude token, or MCP token as an OpenAI API bearer token.
- Do not route image generation through the Claude Code `ccs codex` gateway unless the current App Server path is live-proven to return an `imageGeneration` item.
- Keep outputs inside the current project unless the user gives another path. Prefer `generated/images/` or another ignored/project-safe output directory.
- Do not print bearer tokens or full sensitive responses.

## Workflow

1. If the host exposes a native image tool, use it directly. For Codex system ImageGen, call the available image-generation tool rather than shelling out to API curl.
2. Save or move the resulting image to the requested safe output path.
3. Report the output path, whether this was generation or editing, and whether transparency was requested.
4. If native ImageGen is unavailable, say so. Offer the OpenAI API path only as an explicit fallback that may bill the user's OpenAI API project and requires `OPENAI_API_KEY`.
5. If the user chooses the API fallback, refresh the request shape against official OpenAI docs before using it.

## Notes for Claude Code bridge mode

Under `ccs codex`, Claude Code is the client and Codex App Server is the backend. Official ChatGPT-plan App Server docs currently mark hosted image generation unsupported for that route. Until a live bridge test proves otherwise, keep image generation host-native to Codex sessions that expose ImageGen and do not advertise it as Claude Code `/model` parity.
