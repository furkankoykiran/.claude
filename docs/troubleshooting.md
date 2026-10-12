# Troubleshooting

Common failures and how to resolve them. If none of these match, open an issue
with the output of the failing command.

## Troubleshooting

<details>
<summary><strong>Linux: "gstack setup failed: Playwright Chromium could not be launched" / <code>libatk-1.0.so.0: cannot open shared object file</code></strong></summary>

The Chromium *binary* downloads fine, but on a clean server/container its
OS-level shared libraries (GTK/graphics: `libatk`, `libnss3`, `libcups`, …) are
missing, so it can't *launch*. The installer now fixes this automatically
(`ensure_browser_deps` + a Playwright `install-deps` retry). To repair an
existing install by hand, as root:

```bash
cd ~/.claude/skills/gstack && bunx playwright install-deps chromium && ./setup --no-prefix
```

On Ubuntu 24.04+ some packages were renamed (`libasound2` → `libasound2t64`,
etc.); Playwright's `install-deps` knows the current names, which is why it's
preferred over a hand-written `apt` list.
</details>

<details>
<summary><strong>Windows: "Git Bash (bash.exe) not found"</strong></summary>

gstack's setup is a bash script. Install [Git for Windows](https://git-scm.com/download/win)
(it bundles Git Bash) and re-run `install.ps1`.
</details>

<details>
<summary><strong>Windows: gstack browser/screenshots don't work</strong></summary>

On Windows, Chromium is driven by **Node.js** (Bun can't launch it there —
[oven-sh/bun#4253](https://github.com/oven-sh/bun/issues/4253)). Install
[Node.js LTS](https://nodejs.org/) (or `winget install OpenJS.NodeJS.LTS`) and
re-run.
</details>

<details>
<summary><strong>A tool didn't install / the run ended with a "skipped or failed" summary</strong></summary>

That's the fail-soft design working — the rest of the setup still completed.
Read the listed step name, fix its cause (often a missing system dependency),
and re-run the installer; it's idempotent.
</details>

## AGY versus Gemini activation

`ccs agy` uses the official local CLI session; `ccs gemini` uses separate Developer API/Vertex credentials. `google` and `antigravity` are migration errors. A failed preflight must leave `ccs status` and the previous settings unchanged.

For AGY, check `agy --version`, `agy --help`, `agy models` and a harmless native prompt. Sign in through AGY itself, then retry `ccs agy`. Configure `AGY_GATEWAY_BIN` only if PATH discovery cannot find the official executable. A catalog is not login proof: activation requires a new nonce response and the native execution guard. Malformed, incompatible or uncorrelated protocol output fails closed. Do not paste OAuth/session files into toolkit config or issue reports.

For Gemini, configure its own supported credentials and `GEMINI_GATEWAY_MODEL`. Vertex requires an explicit Cloud token/project and `GEMINI_GATEWAY_ADAPTER=vertex`; ADC loading is not implemented. Invalid/missing credentials, unavailable models, quota failures or bad nonce replies refuse activation. There is no silent AGY fallback. Start/reload changes must replace only the owned sidecar; an unrelated PID/listener is left untouched.
