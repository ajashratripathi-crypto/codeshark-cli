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