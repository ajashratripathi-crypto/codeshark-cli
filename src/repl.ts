import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { bold, dim, hex } from "./ansi.js";
import { runAgent } from "./agent.js";
import { ToolRegistry } from "./tools/index.js";
import { ChatClient, ChatMessage, ProviderError, StreamEvents, ToolCall, errorMessage } from "./provider/types.js";
import { runSetup } from "./setup.js";
import { loadConfig, modelLabel, saveConfig } from "./config.js";
import { DEFAULT_MODEL_ID, MODELS, findModel } from "./models.js";
import { resolveClients } from "./provider/index.js";
import { launchKeysPage } from "./keysPage.js";
import { defaultSystemPrompt, type AgentMode } from "./system.js";
import { startActivityIndicator, toolPhase } from "./loading.js";
import { modelAvailability, modelAvailabilityReason } from "./modelAvailability.js";

export interface ReplOptions {
  cwd: string;
  registry: ToolRegistry;
  /** Called to (re)build the provider chain — lets /model and /setup take effect live. */
  getClients: () => ChatClient[];
  debug?: (msg: string) => void;
}

const PROMPT = "> ";

function replClosed(rl: Interface): boolean {
  return Boolean((rl as unknown as { closed?: boolean }).closed);
}

function briefArgs(args: Record<string, unknown>): string {
  const s = JSON.stringify(args);
  return s.length > 90 ? s.slice(0, 90) + "…" : s;
}

async function approveToolCall(rl: Interface, call: ToolCall, signal?: AbortSignal): Promise<boolean> {
  rl.resume();
  const answer = await rl.question(`\n  Approve ${call.name}(${briefArgs(call.args)})? [y/N]: `, { signal });
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

function printHelp(): void {
  console.log(
    [
      "",
      bold("  CodeShark commands"),
      dim("    /help            show this help"),
      dim("    /model           show the active model and the full catalog"),
      dim("    /model <name>    switch model, e.g. /model glm or /model deepseek"),
      dim("    /keys            open the password-protected local API key page"),
      dim("    /key-status      show masked key status in the terminal"),
      dim("    /setup           guided setup wizard (providers / keys)"),
      dim("    /plan            switch to read-only planning mode"),
      dim("    /build           switch to implementation mode"),
      dim("    /clear           clear the screen"),
      dim("    /quit            exit (Ctrl+C also works)"),
      "",
    ].join("\n"),
  );
}

export function printModelInfo(): void {
  const cfg = loadConfig();
  console.log("");
  console.log(`  Active: ${bold(hex("#4ade80", modelLabel(cfg)))}`);
  console.log("");
  console.log(bold("  Model catalog"));
  for (const m of MODELS) {
    const active = m.id === (findModel(cfg.model ?? "")?.id ?? DEFAULT_MODEL_ID);
    const status = modelAvailability(m.id);
    const marker = status === "available" ? hex("#4ade80", "●") : status === "unavailable" ? hex("#f87171", "✗") : status === "busy" ? hex("#fbbf24", "◐") : dim("○");
    const note =
      status === "unavailable"
        ? `Unavailable${modelAvailabilityReason(m.id) ? ` — ${modelAvailabilityReason(m.id)}` : ""}`
        : status === "busy"
          ? `Lane busy${modelAvailabilityReason(m.id) ? ` — ${modelAvailabilityReason(m.id)}` : ""} — should still work`
          : m.notes;
    const styled = status === "unavailable" ? hex("#f87171", note) : status === "busy" ? hex("#fbbf24", note) : note;
    console.log(`    ${marker} ${m.label.padEnd(28)} ${dim(m.context.padEnd(5))} ${styled}`);
  }
  console.log("");
  console.log(dim("  Switch with: /model <name>"));
  console.log(dim("  Names: gpt, deepseek, minimax, glm, gemini-3.6, sarvam, gpt-oss, nemotron"));
  console.log("");
}

export function switchModel(query: string): void {
  const q = query.trim();
  if (!q) {
    printModelInfo();
    return;
  }
  const cfg = loadConfig();
  const entry =
    findModel(q) ??
    MODELS.find((m) => m.id.toLowerCase().includes(q.toLowerCase()) || m.label.toLowerCase().includes(q.toLowerCase()));

  if (!entry) {
    console.log(hex("#f87171", `  ✗ No model matches "${q}".`));
    console.log(dim("  Available: " + MODELS.map((m) => m.label).join(", ")));
    return;
  }

  if (entry.available === false) {
    console.log(hex("#f87171", `  ✗ ${entry.label} is unavailable — it was removed by the provider.`));
    console.log(dim("  Choose one of the currently available models listed by /model."));
    return;
  }

  if (modelAvailability(entry.id) === "unavailable") {
    console.log(hex("#f87171", `  ✗ ${entry.label} is currently unavailable.`));
    console.log(dim(`  ${modelAvailabilityReason(entry.id) ?? "The boot health check failed."}`));
    return;
  }

  if (modelAvailability(entry.id) === "busy") {
    console.log(hex("#fbbf24", `  ⚠ ${entry.label}'s shared lane is busy right now — switching anyway. Requests may wait or retry.`));
  }

  cfg.model = entry.id;
  saveConfig(cfg);
  console.log(`  ${hex("#4ade80", "✓")} Switched to ${bold(entry.label)} ${dim(`(${entry.context} context)`)}`);
  console.log(dim("  Applies immediately — just start chatting."));
  console.log("");
}

function printKeys(): void {
  const cfg = loadConfig();
  console.log("");
  console.log(bold("  API keys"));
  const ur = Boolean(cfg.unorouterApiKey ?? process.env.UNOROUTER_API_KEY);
  const or = Boolean(cfg.openrouterApiKey ?? process.env.OPENROUTER_API_KEY);
  const nv = Boolean(cfg.nvidiaApiKey ?? process.env.NVIDIA_API_KEY);
  const gm = Boolean(cfg.geminiApiKey ?? process.env.GEMINI_API_KEY);
  console.log(`    ${ur ? hex("#4ade80", "✓") : dim("○")} Model API    ${ur ? dim("(configured)") : dim("(not set)")}  ${dim("key: shown once")}`);
  console.log(`    ${or ? hex("#4ade80", "✓") : dim("○")} OpenRouter   ${or ? dim("(configured)") : dim("(not set)")}  → https://openrouter.ai/keys  ${dim("key: sk-or-v1-…")}`);
  console.log(`    ${nv ? hex("#4ade80", "✓") : dim("○")} NVIDIA NIM   ${nv ? dim("(configured)") : dim("(not set)")}  → https://build.nvidia.com   ${dim("key: nvapi-…")}`);
  console.log(`    ${gm ? hex("#4ade80", "✓") : dim("○")} Google AI Studio ${gm ? dim("(configured)") : dim("(not set)")}  → https://aistudio.google.com/apikey ${dim("key: AIza…")}`);
  console.log("");
  console.log(dim("  Add one: run /setup, or paste it into ~/.codeshark.json like:"));
  console.log(dim('    { "unorouterApiKey": "your-key", "openrouterApiKey": "sk-or-v1-…" }'));
  console.log(dim("  Or set the provider environment variables configured for your deployment."));
  console.log("");
}

export async function startRepl(opts: ReplOptions): Promise<void> {
  const rl = createInterface({ input, output });
  rl.setPrompt(PROMPT);
  let history: ChatMessage[] = [];
  let mode: AgentMode = "build";
  let busy = false;
  let controller: AbortController | undefined;

  console.log(dim("  Type a message and press Enter. /help for commands · Ctrl+C cancels a request; press again to quit."));
  rl.prompt();

  rl.on("SIGINT", () => {
    if (controller && !controller.signal.aborted) {
      controller.abort(new Error("Request cancelled."));
      return;
    }
    console.log("");
    console.log(dim("Bye!"));
    process.exit(0);
  });

  rl.on("line", async (raw) => {
    if (busy) return;
    const line = raw.trim();
    if (!line) {
      if (!replClosed(rl)) rl.prompt();
      return;
    }

    // Commands
    if (line.startsWith("/")) {
      busy = true;
      try {
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      switch (cmd) {
        case "help":
        case "h":
          printHelp();
          break;
        case "model":
        case "m":
          if (rest.length) switchModel(rest.join(" "));
          else printModelInfo();
          break;
        case "keys":
        case "key":
          console.log(dim(`  Opening local key vault… ${await launchKeysPage()}`));
          console.log(dim("  The browser page asks for a password before showing keys."));
          break;
        case "key-status":
        case "keystatus":
          printKeys();
          break;
        case "clear":
          history = [];
          process.stdout.write("\u001b[2J\u001b[H");
          break;
        case "setup":
          rl.pause();
          await runSetup();
          rl.resume();
          console.log(dim("  Provider chain reloaded."));
          break;
        case "plan":
          mode = "plan";
          console.log(dim("  Plan mode enabled. The agent will inspect and explain without changing files."));
          break;
        case "build":
          mode = "build";
          console.log(dim("  Build mode enabled. The agent can implement changes and verify them."));
          break;
        case "quit":
        case "exit":
        case "q":
          console.log(dim("Bye!"));
          process.exit(0);
          break;
        default:
          console.log(dim(`  Unknown command "${cmd}". Try /help.`));
      }
      } catch (error) {
        console.log(hex("#f87171", "  " + errorMessage(error)));
      } finally {
        busy = false;
        if (!replClosed(rl)) rl.resume();
      }
      if (!replClosed(rl)) rl.prompt();
      return;
    }

    // Agent run
    busy = true;
    controller = new AbortController();
    // Keep input active so Ctrl+C can cancel while the model is working.
    rl.resume();
    console.log("");
    const activity = startActivityIndicator("Thinking");
    let activityActive = true;
    const stopActivity = () => {
      if (activityActive) {
        activityActive = false;
        activity.stop();
      }
    };
    const events: StreamEvents = {
      onText: (delta) => {
        stopActivity();
        process.stdout.write(delta);
      },
      onToolCall: (call) => {
        console.log(dim(`  ⚙ ${call.name}(${briefArgs(call.args)})`));
        activity.setPhase(toolPhase(call.name));
      },
      onToolResult: (toolName) => {
        activity.setPhase(toolName === "finish" ? "Wrapping up" : "Thinking");
      },
      onDebug: (msg) => console.log(dim(msg)),
    };
    try {
      const cfg = loadConfig();
      const result = await runAgent(
        line,
        {
          clients: opts.getClients(),
          registry: opts.registry,
          cwd: opts.cwd,
          systemPrompt: cfg.systemPrompt ?? defaultSystemPrompt(opts.cwd, mode),
          readOnly: mode === "plan",
          maxIterations: cfg.maxIterations,
          approveToolCall: async (call) => {
            activity.pause();
            try {
              return await approveToolCall(rl, call, controller?.signal);
            } finally {
              activity.resume(toolPhase(call.name));
            }
          },
          signal: controller.signal,
          debug: opts.debug,
          initialMessages: history,
        },
        events,
      );
      stopActivity();
      history = result.history;
      if (result.streamedText) {
        if (!result.streamedText.endsWith("\n")) process.stdout.write("\n");
      } else if (result.text) {
        process.stdout.write(result.text.endsWith("\n") ? result.text : result.text + "\n");
      }
    } catch (e) {
      stopActivity();
      console.log("");
      if (e instanceof ProviderError) {
        console.log(hex("#f87171", `  ✗ ${e.message}`));
        if (e.kind === "network") {
          console.log(dim("  The provider is unreachable. Run /keys to configure your own key."));
        } else if (e.kind === "auth" || e.kind === "rate_limit") {
          console.log(dim("  Run /setup to fix this, or /model to pick a different model."));
        }
      } else {
        console.log(hex("#f87171", `  ✗ ${errorMessage(e)}`));
      }
    }
    busy = false;
    controller = undefined;
    console.log("");
    if (!replClosed(rl)) {
      rl.resume();
      rl.prompt();
    }
  });

  await new Promise<void>(() => {
    // Keep the interface alive; SIGINT handles exit.
  });
}
