#!/usr/bin/env node
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { bold, dim, hex } from "./ansi.js";
import { printBanner } from "./banner.js";
import { showLoading, startThinkingSpinner } from "./loading.js";
import { loadConfig, saveConfig } from "./config.js";
import { readTerms } from "./terms.js";
import { resolveClients } from "./provider/index.js";
import { createRegistry } from "./tools/index.js";
import { printModelInfo, startRepl, switchModel } from "./repl.js";
import { runSetup, runSetupFlow } from "./setup.js";
import { runAgent } from "./agent.js";
import { errorMessage, ToolCall } from "./provider/types.js";
import { launchKeysPage } from "./keysPage.js";
import { extractFolderArg, openProjectFolder, requireProjectFolder } from "./project.js";
import { installLatestVersion, isNewerVersion, latestPublishedVersion } from "./update.js";

const require = createRequire(import.meta.url);
const VERSION = (require("../package.json") as { version: string }).version;

function printHelp(): void {
  console.log(
    [
      "",
      bold("CodeShark") + dim(` v${VERSION} — a terminal coding agent`),
      "",
      "  Usage:",
      "    codeshark                  start chat in the current project folder",
      "    codeshark <prompt…>        one-shot prompt for the current project folder",
      "    codeshark --folder <path>  open a specific project folder first",
      "    codeshark --folder <path> \"prompt…\"  run a prompt in that folder",
      "    codeshark banner [--plain] print just the CodeShark wordmark",
      "    codeshark setup            guided setup for providers / API keys",
      "    codeshark keys             open the password-protected local key page",
      "    codeshark model            list and switch the model catalog",
      "    codeshark update           check for and install the latest published version",
      "    codeshark terms            read the Terms of Service",
      "    codeshark --version        print the version",
      "",
      "  Zero setup: works out of the box with no API keys. Add your own key",
      "  anytime for your own rate limits and private prompts.", 
      "",
    ].join("\n"),
  );
}

async function updatePackage(): Promise<void> {
  console.log(dim("Checking npm for a newer CodeShark version…"));
  const latest = await latestPublishedVersion();
  if (!latest) {
    console.log(dim("Could not check npm right now. You can retry with `codeshark update`."));
    return;
  }
  if (!isNewerVersion(VERSION, latest)) {
    console.log(dim(`CodeShark ${VERSION} is up to date.`));
    return;
  }

  const rl = createInterface({ input, output });
  const answer = await rl.question(`CodeShark ${latest} is available (you have ${VERSION}). Install it now? [y/N]: `);
  rl.close();
  if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") {
    console.log(dim("Update skipped."));
    return;
  }
  try {
    await installLatestVersion();
    console.log(hex("#4ade80", `Updated to CodeShark ${latest}. Restart CodeShark to use it.`));
  } catch (e) {
    console.log(hex("#f87171", `Update failed: ${errorMessage(e)}`));
  }
}

function isTTY(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.CODESHARK_NO_BANNER;
}

async function runOneShot(prompt: string): Promise<void> {
  const cfg = loadConfig();
  const cwd = process.cwd();
  const registry = createRegistry();
  const clients = resolveClients(cfg, (m) => console.error(dim(m)));
  // Show a "thinking" spinner until the first token arrives, then stream.
  const stopThinking = startThinkingSpinner("Thinking");
  let thinking = true;
  const events = {
    onText: (d: string) => {
      if (thinking) {
        thinking = false;
        stopThinking();
      }
      process.stdout.write(d);
    },
  };
  const approvalRl = process.stdin.isTTY ? createInterface({ input, output }) : undefined;
  try {
    const result = await runAgent(
      prompt,
      {
        clients,
        registry,
        cwd,
        approveToolCall: approvalRl
          ? async (call: ToolCall) => {
              const answer = await approvalRl.question(`\nApprove ${call.name}? [y/N]: `);
              return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
            }
          : async () => false,
      },
      events,
    );
    if (thinking) {
      thinking = false;
      stopThinking();
    }
    if (result.streamedText) {
      if (!result.streamedText.endsWith("\n")) process.stdout.write("\n");
    } else {
      process.stdout.write(result.text.endsWith("\n") ? result.text : result.text + "\n");
    }
  } catch (e) {
    if (thinking) stopThinking();
    console.error(hex("#f87171", `✗ ${errorMessage(e)}`));
    process.exitCode = 1;
  } finally {
    approvalRl?.close();
  }
}

async function main(): Promise<void> {
  const parsed = extractFolderArg(process.argv.slice(2));
  const args = parsed.args;
  const [command, ...rest] = args;

  // These informational commands do not touch a project and work anywhere.
  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }
  if (command === "banner") {
    printBanner({ plain: rest[0] === "--plain" });
    return;
  }
  if (command === "terms") {
    console.log(readTerms());
    return;
  }
  if (command === "update") {
    await updatePackage();
    return;
  }

  // Plain `codeshark` uses the current directory; all agent work remains
  // scoped to that directory, which must be a real folder.
  const projectFolder = openProjectFolder(parsed.folder ?? process.cwd());

  switch (command) {
    case "setup":
      await runSetup();
      return;
    case "keys": {
      const url = await launchKeysPage();
      console.log(`CodeShark key vault: ${url}`);
      console.log("Keep this terminal open while using the page. Press Ctrl+C to stop it.");
      await new Promise<void>(() => {});
      return;
    }
    case "model": {
      // `codeshark model` lists the catalog; `codeshark model <name>` switches.
      if (rest.length) {
        switchModel(rest.join(" "));
        return;
      }
      printModelInfo();
      return;
    }
    case "chat":
      break;
    default:
      if (command !== undefined && !command.startsWith("-")) {
        await runOneShot(args.join(" "));
        return;
      }
      break;
  }

  // Interactive mode.
  const cfg = loadConfig();
  const cwd = projectFolder;
  if (isTTY()) {
    // One-time Terms of Service acceptance before anything else runs.
    if (!cfg.termsAccepted) {
      const rl = createInterface({ input, output });
      const answer = (
        await rl.question(
          "  CodeShark is provided as-is with no warranty. By continuing you agree to the Terms of Service — type `codeshark terms` to read them. Continue? [y/N]: ",
        )
      )
        .trim()
        .toLowerCase();
      rl.close();
      if (answer !== "y" && answer !== "yes") {
        console.log(dim("  Terms not accepted — nothing was changed. Run `codeshark terms` to read them."));
        return;
      }
      cfg.termsAccepted = true;
      saveConfig(cfg);
      console.log("");
    }

    // First run: let the user pick between the shared gateway, their own
    // API key (recommended), or local Ollama — the same flow as `codeshark setup`.
    const hasProviderSetup =
      Boolean(cfg.provider) ||
      Boolean(cfg.unorouterApiKey || cfg.openrouterApiKey || cfg.nvidiaApiKey || cfg.geminiApiKey) ||
      Boolean(
        process.env.UNOROUTER_API_KEY ||
          process.env.OPENROUTER_API_KEY ||
          process.env.NVIDIA_API_KEY ||
          process.env.GEMINI_API_KEY,
      );
    if (!hasProviderSetup) {
      const rl = createInterface({ input, output });
      await runSetupFlow(cfg, rl, { title: "Welcome to CodeShark" });
      rl.close();
      console.log("");
    }
    if (process.env.CODESHARK_NO_UPDATE === undefined) {
      const latest = await latestPublishedVersion();
      if (latest && isNewerVersion(VERSION, latest)) {
        const rl = createInterface({ input, output });
        const answer = await rl.question(`  CodeShark ${latest} is available. Install it now? [y/N]: `);
        rl.close();
        if (answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes") {
          try {
            await installLatestVersion();
            console.log(hex("#4ade80", `  Updated to CodeShark ${latest}. Restart to use the new version.`));
          } catch (e) {
            console.log(hex("#f87171", `  Update failed: ${errorMessage(e)}`));
          }
        }
      }
    }
    // The REPL prints the input instructions once after the banner. Keeping
    // them out of the banner avoids the duplicated startup line. The loading
    // screen types itself out with a spinner, then hands off to the REPL.
    printBanner();
    await showLoading([
      "Opening project folder",
      "Loading model catalog",
      "Starting the agent",
    ]);
    console.log("");
  }
  const registry = createRegistry();
  const getClients = () => resolveClients(loadConfig());
  await startRepl({ cwd, registry, getClients });
}

main().catch((e) => {
  console.error(hex("#f87171", `✗ ${errorMessage(e)}`));
  process.exit(1);
});