import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { exec } from "node:child_process";
import { bold, dim, hex } from "./ansi.js";
import { CodeSharkConfig, DEFAULT_GEMINI_MODEL, configPath, hasApiKey, loadConfig, saveConfig } from "./config.js";
import { createUnoRouterClient } from "./provider/unorouter.js";
import { createGeminiClient } from "./provider/gemini.js";
import { createOpenRouterClient } from "./provider/openrouter.js";
import { createOllamaClient, ollamaAvailable } from "./provider/ollama.js";
import { MODELS } from "./models.js";
import { ChatClient, errorMessage } from "./provider/types.js";

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "win32"
        ? `cmd /c start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    exec(cmd, () => {});
  } catch {
    // ignore — we print the URL anyway
  }
}

/**
 * Ask for a secret WITHOUT echoing it to the terminal, so pasting an API
 * key never leaves it visible on screen (or in terminal scrollback).
 */
function secretQuestion(rl: ReturnType<typeof createInterface>) {
  return async (prompt: string): Promise<string> => {
    const anyRl = rl as unknown as { _writeToOutput?: (s: string) => void };
    const original = anyRl._writeToOutput;
    anyRl._writeToOutput = () => {}; // swallow the echo of typed characters
    process.stdout.write(prompt);
    const answer = await rl.question("");
    anyRl._writeToOutput = original;
    process.stdout.write("\n");
    return answer.trim();
  };
}

async function testClient(label: string, client: ChatClient): Promise<boolean> {
  process.stdout.write(`  Testing ${label}… `);
  try {
    await client.chat([{ role: "user", content: "Reply with exactly: OK" }], []);
    console.log(hex("#4ade80", "✓ works"));
    return true;
  } catch (e) {
    console.log(hex("#f87171", `✗ ${errorMessage(e)}`));
    return false;
  }
}

/** After keys are saved, offer a numbered model picker and save the choice. */
async function pickModel(rl: ReturnType<typeof createInterface>, cfg: CodeSharkConfig): Promise<void> {
  const available = MODELS.filter((m) => hasApiKey(cfg, m.provider));
  if (!available.length) return;

  console.log("");
  console.log(bold("  Pick your default model:"));
  available.forEach((m, i) => {
    console.log(`    [${i + 1}] ${m.label.padEnd(30)} ${dim(m.context.padEnd(5))}`);
    console.log(`        ${dim(m.notes)}`);
  });
  console.log("");

  const answer = await rl.question(`  Choose [1-${available.length}] (default 1): `);
  const idx = (parseInt(answer.trim(), 10) || 1) - 1;
  const chosen = available[Math.max(0, Math.min(idx, available.length - 1))] ?? available[0];
  if (!chosen) return;
  cfg.model = chosen.id;
  console.log(`  ${hex("#4ade80", "✓")} Default model: ${bold(chosen.label)}`);
}

function saveDone(cfg: CodeSharkConfig): void {
  saveConfig(cfg);
  console.log("");
  console.log(hex("#4ade80", `  ✓ Saved to ${configPath()}`));
  console.log("");
}

/** The `codeshark setup` command: guided provider / key configuration. */
export async function runSetup(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await runSetupFlow(loadConfig(), rl, { title: "CodeShark setup" });
  } finally {
    rl.close();
  }
}

export interface SetupFlowOptions {
  title?: string;
}

/**
 * The provider/key configuration flow, shared by `codeshark setup` and the
 * first-run prompt at CLI startup. Returns true when a choice was saved.
 */
export async function runSetupFlow(
  cfg: CodeSharkConfig,
  rl: ReturnType<typeof createInterface>,
  opts: SetupFlowOptions = {},
): Promise<boolean> {
  const askSecret = secretQuestion(rl);

  console.log("");
  console.log(bold(hex("#d96b43", opts.title ?? "CodeShark setup")));
  console.log("");
  console.log(bold("  How do you want to talk to the models?"));
  console.log(dim("    [1] Shared CodeShark gateway — zero setup. No key on this computer;"));
  console.log(dim("        the gateway's keys stay private on the server."));
  console.log(dim("    [2] My own API key (recommended) — your own rate limits and privacy;"));
  console.log(dim("        typed hidden, stored only on this computer, never shown on screen."));
  console.log(dim("    [3] Local Ollama — fully offline, runs on your machine."));
  console.log(dim("    [4] Cancel — change nothing"));
  console.log("");

  const choice = (await rl.question("  Choose [1-4]: ")).trim();
  const is = (v: string, ...words: string[]) => choice === v || words.some((w) => choice.toLowerCase() === w);

  if (is("4", "cancel", "c", "skip", "s")) {
    console.log(dim("  Skipped — no changes saved."));
    return false;
  }

  if (is("3", "ollama", "o")) {
    cfg.provider = "ollama";
    if (await ollamaAvailable(cfg)) {
      console.log(hex("#4ade80", "  ✓ Ollama reachable"));
    } else {
      console.log(hex("#f87171", "  ✗ Ollama not reachable — install from https://ollama.com and run `ollama serve`."));
    }
    saveDone(cfg);
    return true;
  }

  if (is("1", "gateway", "g")) {
    cfg.provider = "gateway";
    saveDone(cfg);
    console.log(dim("  Zero setup — you're ready. Switch anytime with /setup."));
    console.log("");
    return true;
  }

  // Choice 2 — choose which provider key to configure.
  console.log(bold("  Choose an API provider"));
  console.log(dim("    [1] Primary model API — four free catalog models"));
  console.log(dim("    [2] Gemini API"));
  console.log(dim("    [3] OpenRouter"));
  console.log(dim("    [4] Cancel"));
  const keyChoice = (await rl.question("  Choose [1-4]: ")).trim();
  if (keyChoice === "4") return false;

  if (keyChoice === "2") {
    const gk = await askSecret("  Paste your Gemini API key (Enter to skip): ");
    if (!gk) return false;
    cfg.geminiApiKey = gk;
    cfg.provider = "gemini";
    cfg.model = DEFAULT_GEMINI_MODEL;
    await testClient("Gemini", createGeminiClient(cfg, gk));
    saveDone(cfg);
    return true;
  }
  if (keyChoice === "3") {
    const ok = await askSecret("  Paste your OpenRouter API key (Enter to skip): ");
    if (!ok) return false;
    cfg.openrouterApiKey = ok;
    cfg.provider = "openrouter";
    await testClient("OpenRouter", createOpenRouterClient(cfg, ok));
    saveDone(cfg);
    return true;
  }

  console.log(bold("  Step 1 — Model API key (unlocks all 4 free models)"));
  console.log(dim("    1. Open the provider token page shown by your administrator"));
  console.log(dim("    2. Create an API key — it is shown exactly once — and copy it"));
  console.log(dim("    Your key is typed hidden: it will not appear on screen."));
  openBrowser("https://unorouter.com/en/tokens");
  const urKey = await askSecret("  Paste your model API key (Enter to skip): ");

  if (urKey) {
    cfg.unorouterApiKey = urKey;
    cfg.provider = "unorouter";
    await testClient("Model provider (GLM 5.3 Flash Think Search)", createUnoRouterClient(cfg, urKey));
    await pickModel(rl, cfg);
    saveDone(cfg);
    return true;
  }

  console.log(bold("  Step 2 — Google Gemini key (optional)"));
  console.log(dim("    Get a key at https://aistudio.google.com/apikey (AIza…)."));
  const gk = await askSecret("  Paste your Gemini key (Enter to skip): ");

  if (gk) {
    cfg.geminiApiKey = gk;
    cfg.provider = "gemini";
    cfg.model = DEFAULT_GEMINI_MODEL;
    await testClient("Gemini", createGeminiClient(cfg, gk));
    await pickModel(rl, cfg);
    saveDone(cfg);
    return true;
  }

  // No key pasted: loop back to the provider choice.
  console.log(dim("  No keys pasted."));
  console.log("");
  console.log(dim("    [1] Use shared CodeShark gateway (zero setup)   [2] Use local Ollama   [3] Cancel"));
  const fallback = await rl.question("  Choose: ");
  if (fallback.trim() === "2") {
    cfg.provider = "ollama";
    if (await ollamaAvailable(cfg)) {
      console.log(hex("#4ade80", "  ✓ Ollama reachable"));
    } else {
      console.log(hex("#f87171", "  ✗ Ollama not reachable — install from https://ollama.com and run `ollama serve`."));
    }
  } else if (fallback.trim() === "3") {
    console.log(dim("  Cancelled — nothing changed."));
    return false;
  } else {
    cfg.provider = "gateway";
    console.log(dim("  Using the shared gateway — zero setup. You can add your own key later with /setup."));
  }
  saveDone(cfg);
  return true;
}