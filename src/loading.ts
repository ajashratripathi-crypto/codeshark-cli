import { dim, hex } from "./ansi.js";

/**
 * Startup animation helpers: a typewriter-style loading screen and a
 * "thinking" spinner. Zero dependencies; both degrade to static output
 * when stdout is not a TTY (pipes, CI, tests).
 */

// Braille dots look great in Windows Terminal and modern terminals;
// legacy consoles get the classic -\|/ frames.
const FRAMES: string[] =
  process.platform === "win32" && !process.env.WT_SESSION
    ? ["-", "\\", "|", "/"]
    : ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ACCENT = "#8ba3ba";
const OK = "#4ade80";

const TICK_MS = 14; // per typed character
const DONE_MS = 130; // hold the check before the next step

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function canAnimate(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.CODESHARK_NO_LOADING;
}

/**
 * Startup loading screen. Each step's text types itself out character by
 * character ("a", "am", "ame", …) while a spinner cycles beside it, then
 * locks in with a green ✓ before the next step begins. Non-TTY output
 * prints the steps instantly.
 */
export async function showLoading(steps: string[]): Promise<void> {
  if (!canAnimate()) {
    for (const step of steps) console.log(dim(`  ${step}`));
    return;
  }
  const write = (line: string) => process.stdout.write(`\r\u001b[2K${line}`);
  for (const step of steps) {
    let frame = 0;
    for (let i = 0; i <= step.length; i++) {
      const f = FRAMES[frame % FRAMES.length]!;
      write(`  ${hex(ACCENT, f)} ${step.slice(0, i)}`);
      frame++;
      await sleep(TICK_MS);
    }
    write(`  ${hex(OK, "✓")} ${step}`);
    await sleep(DONE_MS);
  }
  process.stdout.write("\n");
}

/**
 * A "thinking" spinner on a single line. Returns a stop function that
 * clears the line — call it as soon as the first token arrives.
 */
export function startThinkingSpinner(label: string): () => void {
  if (!canAnimate()) return () => {};
  let frame = 0;
  process.stdout.write(`\r\u001b[2K  ${hex(ACCENT, FRAMES[0]!)} ${label}`);
  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    process.stdout.write(`\r\u001b[2K  ${hex(ACCENT, FRAMES[frame]!)} ${label}`);
  }, 80);
  return () => {
    clearInterval(timer);
    process.stdout.write("\r\u001b[2K");
  };
}

/** Human phase label for a tool call — shown by activity indicators. */
export function toolPhase(name: string): string {
  switch (name) {
    case "run_command":
      return "Running command";
    case "read_file":
      return "Reading files";
    case "write_file":
      return "Writing files";
    case "edit_file":
      return "Editing files";
    case "glob":
      return "Finding files";
    case "list_directory":
      return "Listing directory";
    case "code_search":
      return "Searching code";
    case "finish":
      return "Wrapping up";
    default:
      return `Running ${name}`;
  }
}

/**
 * A live "what is the agent doing right now" indicator for interactive
 * sessions: a spinner, a rotating phase label (Thinking, Reading files,
 * Running commands, …) and an elapsed-seconds counter. Pauses during tool
 * approval so the question stays readable, then resumes automatically.
 */
export interface ActivityIndicator {
  setPhase(phase: string): void;
  /** Freeze the display (e.g. while asking the user for approval). */
  pause(): void;
  /** Resume after a pause with a fresh label. */
  resume(phase: string): void;
  stop(): void;
}

export function startActivityIndicator(initialPhase = "Thinking"): ActivityIndicator {
  if (!canAnimate()) {
    return { setPhase: () => {}, pause: () => {}, resume: () => {}, stop: () => {} };
  }
  let phase = initialPhase;
  let frame = 0;
  let paused = false;
  let pausedLine = "";
  const startedAt = Date.now();
  const render = (pausedText?: string) => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const suffix = pausedText ?? `${phase} · ${seconds}s`;
    process.stdout.write(`\r\u001b[2K  ${hex(ACCENT, FRAMES[frame % FRAMES.length]!)} ${suffix}`);
  };
  render();
  const timer = setInterval(() => {
    frame++;
    if (!paused) render();
  }, 90);
  const clearLine = () => process.stdout.write("\r\u001b[2K");
  return {
    setPhase(next) {
      phase = next;
      if (!paused) render();
    },
    pause() {
      if (paused) return;
      paused = true;
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      pausedLine = `${phase} · ${seconds}s — waiting for your approval`;
      render(hex("#fbbf24", `⏸ ${pausedLine}`));
    },
    resume(next) {
      phase = next;
      paused = false;
      render();
    },
    stop() {
      clearInterval(timer);
      clearLine();
    },
  };
}
