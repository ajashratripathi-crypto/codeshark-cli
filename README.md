# CODESHARK

[![CI](https://github.com/ajashratripathi-crypto/codeshark-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/ajashratripathi-crypto/codeshark-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/codeshark-cli)](https://www.npmjs.com/package/codeshark-cli)
[![license](https://img.shields.io/npm/l/codeshark-cli)](LICENSE)

An open-source coding agent that reads your project, plans the work, edits files, and runs commands—with your approval. Four model choices, one familiar terminal.

[Source code](https://github.com/ajashratripathi-crypto/codeshark-cli) | [Quick start](#quick-start) | [Models](#models) | [License](LICENSE)

## Quick start

Requires **Node.js 18.17 or later** and npm.

### Install with npm

```bash
npm install -g codeshark-cli
```

Then open the project you want to work on:

```bash
cd path/to/your-project
codeshark --folder .
```

Or send a task directly:

```bash
codeshark --folder . "explain this project"
codeshark --folder . "find and fix the failing tests"
```

Or run without a global installation:

```bash
npx codeshark-cli --folder .
```

CodeShark works with project folders. Run it from your project directory or choose a folder with `--folder` or `--cwd`.

On first launch, follow the connection setup and accept the [Terms](TERMS.md). The shared gateway lets you start without a personal API key; its free lanes are shared, rate-limited, and subject to availability.

### Install from source

```bash
git clone https://github.com/ajashratripathi-crypto/codeshark-cli.git
cd codeshark-cli
npm install
npm run build
npm install -g .
```

For contributors or anyone who prefers a local build. If the command is not recognized after building, use `node dist/index.js --folder .` from the checkout.

## Everyday commands

| Command | What it does |
| --- | --- |
| `codeshark --folder .` | Start an interactive session in this folder |
| `codeshark --folder . "your task"` | Run a one-shot task |
| `codeshark setup` | Configure your connection and model |
| `codeshark model` | Show the model catalog |
| `codeshark keys` | Open the password-protected local key vault |
| `codeshark banner` | Print the CODESHARK banner |
| `codeshark update` | Check for and install an npm update |
| `codeshark terms` | Read the terms |

Inside a conversation:

```text
/help       Show available commands
/plan       Work through a plan
/build      Switch to building
/model      See model choices
/keys       Open the local key vault
/setup      Reconfigure your connection
/clear      Clear the conversation
/quit       End the session
```

For example, `/model glm` switches to GLM 5.3 Flash Think Search. Your selection is saved locally.

## Models

The catalog is checked at startup, and unavailable models are marked. These context windows describe the configured catalog; availability depends on the connection and provider.

| Model | Context | Selection command |
| --- | --- | --- |
| **GLM 5.3 Flash Think Search — default** | **1M** | `/model glm` |
| Gemini 3.6 Flash | 1M | `/model gemini-3.6` |
| Nemotron 3 Ultra 550B A55B | 256K | `/model nemotron` |
| MiniMax M2.7 | 128K | `/model minimax` |

## Connection and privacy

Run `codeshark setup` to choose the shared gateway, your own API connection, or local Ollama. Provider keys are stored on your computer and are typed hidden during setup. `codeshark keys` opens a password-protected local page for managing them.

When you use hosted models, prompts and relevant project content are sent through your configured connection. A personal key does not make hosted processing local; the provider’s privacy and retention policies still apply. See the [Privacy Notice](PRIVACY.md) and [Terms](TERMS.md).

Configuration is stored in `~/.codeshark.json`. Environment options include `CODESHARK_MODEL`, `CODESHARK_GATEWAY_URL`, `CODESHARK_GATEWAY_KEY`, `CODESHARK_NO_COLOR`, `CODESHARK_NO_BANNER`, and `CODESHARK_NO_UPDATE`.

## Releasing

Publishing is automated: pushing a version tag runs the tests, publishes to npm, and cuts a GitHub Release with notes.

```bash
# bump "version" in package.json first, then:
git tag v0.1.8
git push origin v0.1.8
```

One-time setup: add an npm Granular Access Token (packages: read-write on `codeshark-cli`, two-factor: bypass) as the `NPM_TOKEN` repository secret.

## Update

```bash
npm install -g codeshark-cli@latest
```

## Development

```bash
npm install
npm run build
npm run typecheck
npm test
```

## License

[MIT](LICENSE).

## Provider details

The current free catalog uses UnoRouter through an OpenAI-compatible connection. Configure your own key with `codeshark setup`. Additional adapters support OpenRouter, Gemini, and local Ollama.
