---
name: openai-image
description: Generate/edit images via Codex ImageGen.
allowed-tools:
  - Bash
  - Read
---

# Codex native image generation

Use this skill when the user wants image generation or editing from Codex. Use host-native ImageGen as the default path. Do not require an OpenAI API key for native Codex image generation.

## Boundaries

- Default path: native ImageGen / `$imagegen` / built-in `image_gen` exposed by the current Codex or ChatGPT host.
- Do not claim ChatGPT Plus, Pro, Team, or Codex App Server includes OpenAI API image credits.
- Do not use a ChatGPT OAuth token, Codex token, Claude token, or MCP token as an OpenAI API bearer token.
- Do not route image generation through the Claude Code `ccs codex` gateway unless the current App Server path is live-proven to return an `imageGeneration` item. Use direct Codex ImageGen instead when available.
- Keep outputs inside the current project unless the user gives another path. Prefer `generated/images/` or another ignored/project-safe output directory.
- Do not print bearer tokens or full sensitive responses.

## Workflow

1. Use the host-native image tool directly. For Codex system ImageGen, call the available built-in image-generation tool rather than shelling out to API curl.
2. Save or move the resulting image to the requested safe output path.
3. Report the output path, whether this was generation or editing, and whether transparency was requested.
4. If native ImageGen is unavailable in the current host, say so. Offer the OpenAI API path only as an explicit fallback that may bill the user's OpenAI API project and requires `OPENAI_API_KEY`.
5. If the user chooses the API fallback, refresh the request shape against official OpenAI docs before using it.

## Notes for Claude Code bridge mode

Under `ccs codex`, Claude Code is the client and Codex App Server is the backend. Codex hosts can expose native ImageGen, but the Claude Code bridge still needs a live App Server proof before this toolkit advertises image generation as gateway parity. Until that proof exists, keep image work on the direct Codex ImageGen path and do not present it as Claude Code `/model` parity.
