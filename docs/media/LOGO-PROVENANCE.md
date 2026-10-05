# Launch video logo provenance

The overview video (`launch.mp4`) shows the provider routes the repository
presents as implemented or supported. Template-only providers are not shown.

| Provider shown | Matrix status | Mark used | Source | Source type | Canvas |
| --- | --- | --- | --- | --- | --- |
| Anthropic | Stable default | "A\" mark, 180×180 raster | `https://www.anthropic.com/images/icons/apple-touch-icon.png` | Official, published by the vendor | 1:1 |
| Codex (OpenAI) | Experimental bridge | OpenAI symbol, 24×24 SVG | `https://www.svgrepo.com/show/306500/openai.svg` | Third-party mirror, user-approved exception. Not an OpenAI-published asset. | 1:1 |
| NVIDIA (hosted and NIM) | Experimental / advanced | NVIDIA eye mark, 48×48 favicon (ICO), shown at 96 px | `https://www.nvidia.com/favicon.ico` | Official, published by the vendor. Low resolution, user-approved compromise. | 1:1 |
| Z.ai | Supported | Z.ai mark, 30×30 SVG | `https://z-cdn.chatglm.cn/z-ai/static/logo.svg` (linked from z.ai) | Official, vendor-hosted | 1:1 |

Rules applied:

- Each mark is used unaltered: no redraw, recolor, distortion, or wordmark
  substitution. Transparent padding is kept.
- The Anthropic and NVIDIA sources are the vendor's own published assets.
- The Codex mark comes from a third-party mirror the maintainer approved for
  this video. Replace it with an OpenAI-published asset if one becomes available.
- The Wikimedia Commons copy of the NVIDIA logo was not used.
- Music and sound effects are not included. The bundled tracks' license terms
  are not verified for repository redistribution.

The video is silent and has no audio stream.
