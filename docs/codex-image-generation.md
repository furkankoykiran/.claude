# Codex and Image Generation

Last checked: 2026-10-01 against official OpenAI documentation.

## Decision

Do not route image generation through ChatGPT-plan Codex App Server.

OpenAI's ChatGPT-plan preview limitations say image generation is an unsupported tool for that flow, including through Codex App Server. The Codex App Server page describes text inference through Responses with a ChatGPT-plan OAuth access token and says `model/list` is a catalog, not an entitlement check. That is enough to draw the line: `ccs codex` may expose Codex text models, but it must not pretend that the same route supports image generation.

The supported image path for this toolkit is separate: use the official OpenAI API with an OpenAI API key. That path can bill the user's OpenAI API project and is not covered by ChatGPT Plus, Pro, Team, or Codex plan usage. The toolkit should be explicit about that every time it offers the feature.

## What is supported

The source skill is `/fk-toolkit-ops:openai-image` at `skills/fk-toolkit-ops/skills/openai-image/SKILL.md`.

It is intentionally small. It tells the agent to:

- require `OPENAI_API_KEY`;
- get explicit approval before making a billable request;
- save files under a safe project path, normally `generated/images/`;
- support generation, editing, and transparent-background workflows only through documented OpenAI API capabilities;
- avoid logging secrets or full sensitive responses.

## What is not supported

- No ChatGPT OAuth token is reused for image generation.
- No Codex App Server hidden image route is assumed.
- No claim is made that ChatGPT-plan usage includes OpenAI API image credits.
- No hosted Responses tools unsupported by the ChatGPT-plan preview are tunneled through the gateway.

## Evidence

Official OpenAI documentation checked for this decision:

- ChatGPT plan preview limitations: unsupported tools include image generation for Sign in with ChatGPT plan usage and Codex App Server. See `https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations`.
- Codex App Server: app-server sends Responses API inference requests with a ChatGPT-plan OAuth token and `model/list` is catalog data, not entitlement proof. See `https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server`.
- OpenAI image generation guide: image generation and editing are available through the OpenAI API image-generation tool, including GPT Image model options such as transparent backgrounds where supported. See `https://developers.openai.com/api/docs/guides/tools-image-generation`.
