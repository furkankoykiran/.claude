# Codex and Image Generation

Last checked: 2026-10-01 against official OpenAI documentation and local Codex 0.159.2 schema/probes.

## Decision

Use Codex-native ImageGen when the running Codex host exposes it. Do not make the OpenAI API the default image path for Codex users.

There are two different surfaces that are easy to mix up:

- Codex/ChatGPT host tools can expose a native image-generation tool, commonly surfaced to agents as ImageGen or `$imagegen`. That path uses the signed-in Codex/ChatGPT environment, not an `OPENAI_API_KEY` in this repository.
- The Claude Code gateway path runs through Codex App Server. Official ChatGPT-plan App Server docs describe text inference over Responses, and the current preview limitation page still lists hosted Responses image generation as unsupported for that route.

So the product stance is: prefer host-native ImageGen where the current Codex runtime actually exposes it; do not tunnel image generation through the Claude Code `ccs codex` gateway until a supported App Server request path is proven; keep OpenAI API image generation only as an explicit, separate fallback when the user asks for API-key billing.

## What is supported

The source skill is `/fk-toolkit-ops:openai-image` at `skills/fk-toolkit-ops/skills/openai-image/SKILL.md`. The name remains for compatibility with the current plugin catalog, but the behavior is native-first:

- use host-native ImageGen / `$imagegen` / `image_gen` when available;
- save generated files under a safe project path, normally `generated/images/`;
- support generation, editing, and transparent-background workflows when the host tool supports them;
- do not require or ask for `OPENAI_API_KEY` for the native Codex path;
- do not claim the Claude Code gateway can call ImageGen until a live `ccs codex` proof shows an `imageGeneration` result item.

## Fallback boundary

OpenAI API image generation remains useful, but it is not the default here. Use it only when the user explicitly wants API-backed image generation or when native ImageGen is unavailable and the user approves the API path. That path may bill the user's OpenAI API project and requires `OPENAI_API_KEY`.

## Evidence

Official OpenAI documentation checked for this decision:

- ChatGPT plan preview limitations list image generation as unsupported for the App Server / Sign in with ChatGPT plan route. See `https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations`.
- Codex App Server documentation describes text inference through Responses with a ChatGPT-plan OAuth token and says `model/list` is catalog data, not entitlement proof. See `https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server`.
- OpenAI image generation docs describe image generation through the Image API and the Responses API image-generation tool. Those docs are about API-backed access and billing, not proof that the Claude Code gateway can invoke Codex host-native ImageGen. See `https://developers.openai.com/api/docs/guides/image-generation`.
- The Codex help article says ChatGPT image-generation limits are separate from Codex usage limits, which is another reason this toolkit must not present API billing as the default Codex path. See `https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan`.

Local evidence checked for this decision:

- `codex app-server generate-json-schema --out ...` in Codex 0.159.2 includes `ImageGenerationThreadItem`, `ImageGenerationFailure`, and image input/output item types. This proves the protocol can represent image-generation results.
- The same generated schema did not show a direct client request parameter dedicated to image generation; turns still start from normal user input.
- A live `codex exec --json` probe asking for native image generation returned a text item only and no `imageGeneration` item or generated file. That probe does not disprove ImageGen in all Codex hosts, but it means this CLI path is not yet proven as a product integration.
