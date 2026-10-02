# Codex and Image Generation

Last checked: 2026-10-01 against official OpenAI documentation, the local Codex `imagegen` skill, and local Codex 0.159.2 schema/probes.

## Decision

Use Codex-native ImageGen as the default image path for Codex users. Do not require the OpenAI API for ordinary image generation or editing in Codex.

There are three separate surfaces that are easy to mix up:

- Codex/ChatGPT hosts expose a native image-generation path, commonly surfaced as ImageGen, `$imagegen`, or the built-in `image_gen` tool. This path uses the signed-in Codex/ChatGPT environment, not an `OPENAI_API_KEY` in this repository.
- Claude Code bridge mode (`ccs codex`) is a different surface: Claude Code is the client, and Codex App Server is the backend. The App Server schema can represent image-generation items, but this repository still needs a live bridge proof before advertising image generation through Claude Code itself.
- The OpenAI API image tools are a separate billing/auth path. They are useful for explicit API workflows and larger automated batches, but they are not the default product path here.

So the product stance is: prefer host-native ImageGen; keep the Claude Code gateway boundary honest until a supported App Server `imageGeneration` result is proven; offer API-backed image generation only when the user explicitly asks for that billing path or accepts it as a fallback.

## What is supported

The source skill is `/fk-toolkit-ops:openai-image` at `skills/fk-toolkit-ops/skills/openai-image/SKILL.md`. The name remains for compatibility with the current plugin catalog, but the behavior is native-first:

- use host-native ImageGen / `$imagegen` / `image_gen` when available;
- save generated files under a safe project path, normally `generated/images/`;
- support generation, editing, reference images, and transparent-background workflows when the host tool supports them;
- do not require or ask for `OPENAI_API_KEY` for the native Codex path;
- do not claim the Claude Code gateway can call ImageGen until a live `ccs codex` proof shows an `imageGeneration` result item.

## Fallback boundary

OpenAI API image generation remains available as a fallback, but it is not the normal Codex path. Use it only when the user explicitly wants API-backed image generation or when native ImageGen is unavailable and the user approves the API path. That path may bill the user's OpenAI API project and requires `OPENAI_API_KEY`.

Do not describe ChatGPT Plus, Pro, Team, Business, or Codex usage as OpenAI API credits. Native ImageGen usage and OpenAI API billing are separate.

## Evidence

Official OpenAI documentation checked for this decision:

- ChatGPT Learn says image generation can be requested in an interactive session and that `$imagegen` invokes the image-generation skill explicitly. It also says built-in image generation uses `gpt-image-2` and counts toward general Codex usage limits. See `https://learn.chatgpt.com/docs/image-generation`.
- The OpenAI API image-generation docs describe the separate Responses API `image_generation` tool and Image API model/options surface. Those docs are about API-backed access and billing, not the default Codex host-native path. See `https://developers.openai.com/api/docs/guides/tools-image-generation`.
- The upstream Codex `imagegen` skill says the default mode is the built-in `image_gen` tool, that it does not require `OPENAI_API_KEY`, and that the CLI/API path is a fallback only when explicitly requested or confirmed. See `https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md`.

Local evidence checked for this decision:

- `/root/.codex/skills/.system/imagegen/SKILL.md` matches the upstream native-first rule: default to built-in `image_gen`; use the API/CLI fallback only by explicit request; never ask for `OPENAI_API_KEY` for built-in mode.
- A live native ImageGen smoke in this Codex session generated `/root/.codex/generated_images/01a0f47b-8488-7661-8451-671d206d886e/call_eSo2r2HPV8ufidq1CZIkPOAE.png` without using `OPENAI_API_KEY` or API curl.
- `codex app-server generate-json-schema --out ...` in Codex 0.159.2 includes `ImageGenerationThreadItem`, `ImageGenerationFailure`, and image input/output item types. This proves the protocol can represent image-generation results.
- The same generated schema did not show a direct client request parameter dedicated to image generation; turns still start from normal user input.
- A live `codex exec --json` probe asking for native image generation returned a text item only and no `imageGeneration` item or generated file. That probe does not disprove ImageGen in Codex hosts, but it means the Claude Code bridge path is not yet product-proven.
