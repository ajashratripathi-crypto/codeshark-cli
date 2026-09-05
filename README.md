# CODESHARK

### Your terminal. Teeth included.

An open-source coding agent that reads your project, plans the work, edits files, and runs commands—with your approval. Eight model choices, one familiar terminal.

[Source code](https://github.com/ajashratripathi-crypto/codeshark-cli) · [Get started](#quick-start) · [Models](#models) · [Website setup](#publish-the-website-with-github-pages) · [MIT license](LICENSE)

## What you can do

- **Explore a codebase.** Search files, trace an implementation, and ask how the pieces fit together.
- **Plan before building.** Use `/plan` to work through an approach, then `/build` to start implementing.
- **Fix and build.** Make focused changes and run relevant commands in your selected project folder.
- **Choose your model.** Switch between eight catalog models from the conversation.
- **Stay involved.** Every tool action asks for approval before it runs.
- **Choose your connection.** Start with the community gateway, configure your own provider key, or use local Ollama.

## Quick start

Requires **Node.js 18.17 or later** and npm.

### Install from source

```bash
git clone https://github.com/ajashratripathi-crypto/codeshark-cli.git
cd codeshark-cli
npm install
npm run build
npm install -g .
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

Once a release is available on npm, you can install it with `npm install -g codeshark-cli`, or run it with `npx codeshark-cli --folder .`.

CodeShark works with project folders. Run it from your project directory or choose a folder with `--folder` or `--cwd`. If the command is not recognized after building this repository, use `node dist/index.js --folder .` from the checkout.

On first launch, follow the connection setup and accept the [Terms](TERMS.md). The shared gateway lets you start without a personal API key; its free lanes are shared, rate-limited, and subject to availability.

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

For example, `/model deepseek-v4-flash` switches to DeepSeek-V4 Flash. Your selection is saved locally.

## Models

The catalog is checked at startup, and unavailable models are marked. These context windows describe the configured catalog; availability depends on the connection and provider.

| Model | Context | Selection command |
| --- | --- | --- |
| Chat-GPT 5.6 Sol | 400K | `/model gpt-5.6-sol` |
| DeepSeek-V4 Flash | 256K | `/model deepseek-v4-flash` |
| MiniMax M3 | 128K | `/model minimax-m3` |
| **GLM 5.3 Flash Think Search — default** | **1M** | `/model glm-5.3-flash-think-search` |
| Gemini 3.6 Flash | 1M | `/model gemini-3.6-flash` |
| Sarvam 30B | 128K | `/model sarvam-30b` |
| GPT-OSS 120B | 128K | `/model gpt-oss-120b` |
| Nemotron 3 Ultra 550B A55B | 256K | `/model nemotron-3-ultra-550b-a55b` |

## Connection and privacy

Run `codeshark setup` to choose the shared gateway, your own API connection, or local Ollama. Provider keys are stored on your computer and are typed hidden during setup. `codeshark keys` opens a password-protected local page for managing them.

When you use hosted models, prompts and relevant project content are sent through your configured connection. A personal key does not make hosted processing local; the provider’s privacy and retention policies still apply. See the [Privacy Notice](PRIVACY.md) and [Terms](TERMS.md).

Configuration is stored in `~/.codeshark.json`. Environment options include `CODESHARK_MODEL`, `CODESHARK_GATEWAY_URL`, `CODESHARK_GATEWAY_KEY`, `CODESHARK_NO_COLOR`, `CODESHARK_NO_BANNER`, and `CODESHARK_NO_UPDATE`.

## Publish the website with GitHub Pages

The website is plain HTML, CSS, and JavaScript. GitHub Pages hosts the website; it does **not** run the terminal agent or the model gateway.

This repository includes a deployment workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml). It publishes only the website assets and linked policy files.

### One-time setup

1. Commit and push the website files and workflow to the `main` branch of [`ajashratripathi-crypto/codeshark-cli`](https://github.com/ajashratripathi-crypto/codeshark-cli).
2. Open the repository’s **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Open **Actions → Deploy CodeShark website → Run workflow**, select `main`, and run it. Later pushes to `main` trigger deployment automatically.
5. When the deployment succeeds, open the URL shown in the workflow’s `github-pages` environment.

Without a custom domain, the expected address is:

**https://ajashratripathi-crypto.github.io/codeshark-cli/**

That address becomes live only after Pages is enabled and deployment succeeds. A repository named `ajashratripathi-crypto.github.io` would instead publish at the account’s root address.

The workflow keeps `index.html` at the published site root and includes `site.css`, `site.js`, `public/og.png`, `PRIVACY.md`, and `TERMS.md`. Relative asset paths let the page work under `/codeshark-cli/`.

If you use a custom domain, update the canonical URL and social image URLs in `index.html` to match it.

### Does it update automatically?

**Local edits do not automatically update GitHub.** A connected Git remote identifies where commits can be pushed; it does not upload every file as you save it.

The update flow is:

```text
Edit locally → review changes → commit → push to main
                                      ↓
                          GitHub README updates
                          Pages workflow publishes the site
```

You can commit and push with your editor’s Source Control panel, GitHub Desktop, or Git. Review the selected files before committing. Website deployment and npm releases are separate: a push does not publish a new CLI package to npm.

For GitHub’s setup instructions, see [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Development

```bash
npm install
npm run typecheck
npm test
npm run worker:build
```

The website needs no framework build. Edit `index.html`, `site.css`, and `site.js`; the Pages workflow copies them directly into the deployment artifact.

| Location | Purpose |
| --- | --- |
| `src/agent.ts` | Model and tool execution loop |
| `src/tools/` | File, search, and shell tools |
| `src/provider/` | Provider adapters |
| `src/banner.ts` | Responsive terminal wordmark |
| `worker/` | Community gateway |
| `index.html`, `site.css`, `site.js` | Public website |
| `.github/workflows/pages.yml` | GitHub Pages deployment |

To release the CLI, run the checks, review `npm pack --dry-run`, bump the package version, and publish with `npm publish --access public`. Publishing requires an npm account with permission to release `codeshark-cli`.

## Contributing

Issues and pull requests are welcome at [ajashratripathi-crypto/codeshark-cli](https://github.com/ajashratripathi-crypto/codeshark-cli). Include a clear description, reproduction steps where relevant, and validation for code changes.

## License

CodeShark is [MIT licensed](LICENSE).

## Provider details and self-hosting

CodeShark’s current free catalog uses UnoRouter through an OpenAI-compatible connection. You can configure your own key during setup. Additional adapters support OpenRouter, NVIDIA NIM, Gemini, and Ollama; their available models and limits depend on your configuration.

For self-hosting, the gateway lives in `worker/` and runs as a Cloudflare Worker. Configure its secrets in your own account:

```bash
cd worker
npx wrangler secret put UNOROUTER_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put NVIDIA_API_KEY
npx wrangler deploy
```

The OpenRouter and NVIDIA keys are optional fallback credentials. Set `gatewayUrl` in your local configuration to your deployed Worker URL. Keep provider credentials in Worker secrets, never in the website or repository.

The gateway accepts supported free-lane identifiers and applies rate limits, queuing, and configured failover. This backend is deployed separately from GitHub Pages. Consult `worker/` and the policy documents before operating a shared gateway.
