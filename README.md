# CodeShark

An open-source **terminal coding agent** — five
frontier models (GPT-5.6 Sol, DeepSeek-V4 Flash, GLM 5.3 Flash Thinking,
Kimi-K3, Gemini 3.6 Flash) behind one OpenAI-compatible endpoint.

Run `codeshark banner` to see the CodeShark wordmark in your terminal.

## How it works

Everything routes through **UnoRouter** (`https://api.unorouter.com/v1`), one
OpenAI-compatible endpoint. CodeShark ships with a zero-setup **community
gateway**, so you can start without configuring anything; bring your own
UnoRouter key whenever you want your own rate limits and private prompts.

The gateway strictly serves only UnoRouter's `:free` lane identifiers — any
other identifier is refused, so there is no paid path through the gateway.

## Quick start

CodeShark is intentionally **project-folder-only**. Running `codeshark` uses
the current directory; `--folder` or `--cwd` selects another directory. It
refuses to operate on an individual file or a path that does not exist.

```bash
# From a cloned checkout:
npm install
npm run build
npm install -g .

# Start CodeShark in the project folder:
codeshark --folder .
codeshark --folder . "explain this project"

# Or select another folder from anywhere:
codeshark --folder path/to/your-project
codeshark --cwd path/to/your-project "fix the tests"

# After the package is published:
npx codeshark-cli       # run from any folder without a global install
npm install -g codeshark-cli
```

Out of the box, CodeShark talks to the community gateway (which routes through
UnoRouter), so there is **nothing to configure**. If you installed from a
checkout and `codeshark` is not recognized yet, use `node dist/index.js
--folder .` or run `npm install -g .`. All file edits, searches, and commands
stay inside the selected project folder.

By using CodeShark you agree to the [Terms of Service](TERMS.md). See the
[Privacy Notice](PRIVACY.md) for gateway, provider, local-key, and website
data handling. The first
interactive start asks you to accept them once, and `codeshark terms` prints
them anytime.

### Setup: shared gateway or your own key?

On first launch the CLI asks how you want to connect — and you can re-run it
anytime with `codeshark setup`:

- **My own API key (recommended)** — typed into the terminal hidden, stored on
  your computer, and not intentionally printed by CodeShark. Your provider's
  retention and privacy terms still apply. One UnoRouter key unlocks all 5
  models.
- **Shared gateway** — no key on your computer at all; the gateway's keys live
  as server-side secrets. Shared free lanes are rate-limited, so the gateway
  **queues** bursts (you wait a moment instead of erroring) and fails over
  between UnoRouter → OpenRouter → NVIDIA automatically.
- **Local Ollama** — fully offline on your own machine.

Your local keys are protected further by the password-locked key vault
(`codeshark keys`) — scrypt-hashed password, session + CSRF tokens, and key
values are not intentionally placed in the page HTML or terminal output.

## Usage

```
codeshark                              interactive chat for the current folder
codeshark --folder .                  interactive chat for this folder
codeshark --folder . "fix the tests"  one-shot prompt for this folder
codeshark banner                      print the CodeShark wordmark (no folder needed)
codeshark --folder . setup            providers / keys wizard
codeshark --folder . model            list the catalog and active model
codeshark --folder . keys             open the local key vault
codeshark update                       check for and install the latest release
```

REPL commands: `/help` `/model` `/keys` `/key-status` `/setup` `/plan` `/build` `/clear` `/quit`
(Ctrl+C also quits). Read the terms anytime with `codeshark terms`. The `/keys` page listens only on `127.0.0.1`, requires a
local password, and keeps key values hidden in password-style fields; the
terminal status command only shows masked values.

Every tool action asks for `y/n` approval before it runs. Shell commands also
keep the dangerous-command blocklist. CodeShark checks npm for updates when an
interactive session starts and asks before installing one; set
`CODESHARK_NO_UPDATE=1` to skip that check for a launch.

To release an update, bump the version with `npm version patch`, run
`npm test`, and publish with `npm publish --access public`. Users can update
manually with `codeshark update` or `npm install -g codeshark-cli@latest`.

Review [TERMS.md](TERMS.md) and [PRIVACY.md](PRIVACY.md) before deploying the
shared gateway for other people. They are not a substitute for legal advice.

## Tools the agent can use

- `read_file` / `write_file` / `edit_file` (strict: `oldString` must match **exactly once** or the edit is rejected)
- `list_directory` / `glob` (`**`, `*`, `?`, `{a,b}`)
- `code_search` (ripgrep when installed, dependency-free fallback otherwise)
- `run_command` (bash / cmd, 30s timeout, output capped) — with a built-in
  danger blocklist: `rm -rf`, `git push`, `sudo`, `curl | sh`, … are refused
  unless you set `CODESHARK_ALLOW_DANGEROUS=1`
- `finish` — the model signals completion with a summary

## Providers & models

Everything runs through **UnoRouter** (`https://api.unorouter.com/v1`), one
OpenAI-compatible endpoint that routes to 45+ upstream providers — all five
catalog models are served on its `:free` lanes. Switch anytime with
`/model <name>` in the REPL (or `codeshark model <name>`).

| Model | API identifier | Context | |
| --- | --- | --- | --- |
| Chat-GPT 5.6 Sol | `gpt-5.6-sol:free` | 400K | |
| DeepSeek-V4 Flash | `deepseek-v4-flash-0731:free` | 256K | |
| GLM 5.3 Flash Thinking | `glm-5.3-flash-thinking:free` | 1M | default |
| Kimi-K3 | `kimi-k3:free` | 256K | |
| Gemini 3.6 Flash | `gemini-3.6-flash:free` | 1M | |

\* All models run through the zero-setup gateway without any key — nothing to
configure.

**Keys:**
- UnoRouter → https://unorouter.com/en/tokens (one key, 200+ models — the only key you really need)
- Google AI Studio → https://aistudio.google.com/apikey (`AIza…`)

Run `codeshark setup` to paste a key and pick a default model — it tests the key
live before saving.

**Rate limits:** shared lanes throttle (~20 req/min, ~200/day). If you hit
a 429, the agent tells you — wait a moment or switch models with `/model`.

## Configuration

`~/.codeshark.json` (env vars override):

```json
{
  "provider": "unorouter",
  "model": "unorouter/glm-5.3-flash-thinking",
  "unorouterApiKey": "ur-…",
  "openrouterApiKey": "sk-…",
  "nvidiaApiKey": "nvapi-…",
  "geminiApiKey": "AIza…",
  "gatewayUrl": "https://your-gateway.workers.dev",
  "ollamaBaseUrl": "http://127.0.0.1:11434/v1",
  "ollamaModel": "qwen3-coder:30b",
  "maxIterations": 25
}
```

Env vars: `CODESHARK_MODEL`, `UNOROUTER_API_KEY`, `OPENROUTER_API_KEY`,
`GEMINI_API_KEY`, `CODESHARK_GATEWAY_URL`, `CODESHARK_GATEWAY_KEY`,
`CODESHARK_NO_COLOR`, `CODESHARK_NO_BANNER`, `CODESHARK_NO_LOADING`,
`CODESHARK_ALLOW_DANGEROUS`.

## Run your own community gateway

Anyone can fork the repo and deploy their own gateway — the URL is configurable,
so your users hit *your* gateway:

```bash
cd worker
npx wrangler secret put UNOROUTER_API_KEY    # your UnoRouter key (primary), stays server-side
npx wrangler secret put OPENROUTER_API_KEY   # optional: OpenRouter fallback key
npx wrangler secret put NVIDIA_API_KEY       # optional: NVIDIA NIM fallback key (nvapi-…)
npx wrangler deploy
```

Then point CodeShark at it:

```bash
codeshark setup   # or edit ~/.codeshark.json: "gatewayUrl": "https://<you>.workers.dev"
```

The gateway serves only `:free` model identifiers — it never routes anything
paid — rate-limits per IP, adds CORS, and refuses any non-`:free` identifier.
When a provider rate-limits (429), the gateway **waits and retries**, then
hands off to the next configured provider (UnoRouter → OpenRouter → NVIDIA),
and per-IP bursts **queue** (wait for a slot) instead of failing. Your keys are
Worker secrets: never logged, never returned, never visible to users. Clients
also retry 429s with backoff, so shared lanes feel smooth.

## Architecture

```
┌────────────┐   messages/tools   ┌──────────────────┐   OpenAI-compatible   ┌──────────────┐
│  terminal  │ ─────────────────▶ │   agent loop      │ ───────────────────▶ │  provider    │
│ (repl/cli) │ ◀───────────────── │ (tools, guard)    │ ◀─────────────────── │  chain       │
└────────────┘   streamed text    └──────────────────┘   SSE stream          └──────┬───────┘
                                                                                    │
                                  gateway (Cloudflare Worker, :free only) ◀─────────┤
                                  unorouter (:free, your key) ◀────────────────────┤
                                  gemini ◀──────────────────────────────────────────┤
                                  ollama (local) ◀──────────────────────────────────┘
```

- `src/provider/` — canonical `ChatClient` interface + adapters (OpenAI-compatible
  shared core, UnoRouter, OpenRouter, NVIDIA NIM, Gemini conversion, Ollama)
- `src/agent.ts` — the loop: model → tool calls → results → repeat (25-iteration guard)
- `src/tools/` — file, search, and shell tools (zero dependencies)
- `src/banner.ts` — the CodeShark wordmark and startup banner
- `worker/` — the Cloudflare Worker gateway

## Share it with other computers

Other people run your CodeShark the exact same way you do — through npm.
Publish once, and anyone with Node.js 18+ can run it from any computer.

The package name is `codeshark-cli` (npm's anti-squatting rules reserve the
bare `codeshark` name, which is too similar to the existing `code-shark`
package). The command you type stays `codeshark`:

```bash
npm login                     # once per computer (create an npm account first)
npm run typecheck && npm test
npm pack --dry-run            # preview exactly what ships: dist/, README, LICENSE
npm publish --access public   # publish version 0.1.0
```

Bump the version for every release: `npm version patch` (or `minor`/`major`),
then `npm publish` again.

From that moment, on **any computer** with Node.js 18+:

```bash
npx codeshark-cli --folder .  # run instantly — no install needed
npm install -g codeshark-cli  # or install it like a real CLI
codeshark --folder .          # then use it anywhere
```

The person on the other computer needs no API key and no account — the model
provider stays server-side, so it works out of the box. The agent only works
inside the folder they open with `--folder`; it edits, searches, and runs
commands there and nowhere else.

Not ready to publish? `npm pack` produces a single `codeshark-<version>.tgz`
file — send that one file and the receiver runs `npm install -g
./codeshark-0.1.0.tgz`.

## Development

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # build + node:test (agent loop, tools, parsers, banner)
npm run worker:build  # typecheck the gateway worker
```

## Roadmap

- [x] Wordmark banner, REPL, one-shot mode, setup wizard
- [x] UnoRouter provider: 5 frontier models, one key
- [x] Agent loop with streaming + tool calling (UnoRouter/Gemini/Ollama/gateway)
- [x] File, search, and shell tools with safety blocklist
- [x] Cloudflare Worker gateway (`:free`-only, UnoRouter-routed)
- [ ] Session memory / project context
- [x] npm package metadata and `npx codeshark-cli`/global-install support (publish manually)
- [ ] Approval prompts for sensitive commands
- [ ] More providers (Groq, Cerebras, …)

## License

MIT.