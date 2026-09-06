import { spawn, spawnSync } from "node:child_process";
import { resolveProjectPath } from "../project.js";
import { Tool } from "./registry.js";

const MAX_OUTPUT_CHARS = 30_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Commands that a coding agent should never run on the user's machine without
 * explicit human approval. CodeShark blocks these by default; set
 * CODESHARK_ALLOW_DANGEROUS=1 to disable the blocklist.
 */
const DANGEROUS_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\brm\s+-(?:[a-z]*r[a-z]*f|f[a-z]*r)\b/i, why: "recursive force delete (rm -rf)" },
  { re: /\bgit\s+push\b/, why: "git push (changes the remote)" },
  { re: /\bgit\s+(?:reset|rebase|clean)\b/, why: "destructive git operation" },
  { re: /\bsudo\b/, why: "sudo / privilege escalation" },
  { re: /\bdd\s+if=/, why: "dd can overwrite disks" },
  { re: /\bmkfs(?:\.\w+)?\b/, why: "filesystem formatting" },
  { re: /\b>:?\s*\/dev\/sd/, why: "raw disk writes" },
  { re: /\b(?:curl|wget)\b.*\|\s*(?:ba)?sh\b/i, why: "downloading and executing a script from the internet" },
  { re: /\bchmod\s+-R\b/, why: "recursive permission change" },
  { re: /\bkill\s+-9\b/, why: "force-killing processes" },
];

export function isDangerousCommand(command: string): string | null {
  const c = command.trim();
  for (const { re, why } of DANGEROUS_PATTERNS) {
    if (re.test(c)) return why;
  }
  return null;
}

let shellCommand: { cmd: string; args: (c: string) => string[] } | null = null;

function pickShell(): { cmd: string; args: (c: string) => string[] } {
  if (shellCommand) return shellCommand;
  if (process.platform === "win32") {
    // Prefer Git Bash; fall back to cmd.exe.
    const probe = spawnSync("bash", ["--version"], { stdio: "ignore" });
    if (probe.status === 0) {
      shellCommand = { cmd: "bash", args: (c) => ["-lc", c] };
    } else {
      shellCommand = { cmd: "cmd.exe", args: (c) => ["/d", "/s", "/c", c] };
    }
  } else {
    shellCommand = { cmd: "bash", args: (c) => ["-lc", c] };
  }
  return shellCommand;
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return `${s.slice(0, MAX_OUTPUT_CHARS)}\n… (truncated ${s.length - MAX_OUTPUT_CHARS} chars)`;
}

export const runCommandTool: Tool = {
  name: "run_command",
  description:
    "Run a shell command (bash on macOS/Linux/Git-Bash, cmd.exe as fallback on Windows) and return its output. The command runs in the working directory with a default 30s timeout (override with timeoutMs). Output is capped at ~30k chars. Destructive commands (rm -rf, git push, sudo, …) are blocked by default.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run." },
      cwd: { type: "string", description: "Working directory for the command. Defaults to the working directory." },
      timeoutMs: { type: "integer", description: "Timeout in milliseconds. Default 30000." },
    },
    required: ["command"],
  },

  async run(args, ctx) {
    const command = String(args.command ?? "").trim();
    if (!command) return "No command provided.";
    const cwd = args.cwd ? resolveProjectPath(String(args.cwd), ctx.cwd) : ctx.cwd;
    const timeoutMs = args.timeoutMs ? Math.min(300_000, Math.max(1000, Number(args.timeoutMs))) : DEFAULT_TIMEOUT_MS;

    const danger = isDangerousCommand(command);
    if (danger && !process.env.CODESHARK_ALLOW_DANGEROUS) {
      throw new Error(
        `Blocked: "${command}" matches the danger pattern "${danger}". CodeShark refuses destructive commands by default (set CODESHARK_ALLOW_DANGEROUS=1 to override).`,
      );
    }

    const shell = pickShell();
    ctx.signal?.throwIfAborted();
    return new Promise<string>((resolvePromise, reject) => {
      const child = spawn(shell.cmd, shell.args(command), { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let stdoutChars = 0;
      let stderrChars = 0;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d: string) => { stdoutChars += d.length; stdout += d.slice(0, Math.max(0, MAX_OUTPUT_CHARS - stdout.length)); });
      child.stderr.on("data", (d: string) => { stderrChars += d.length; stderr += d.slice(0, Math.max(0, MAX_OUTPUT_CHARS - stderr.length)); });
      const stop = () => {
        if (!child.pid) return;
        if (process.platform === "win32") {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
          killer.on("error", () => child.kill());
        } else {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
      };
      ctx.signal?.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", stop);
        const parts = [`$ ${command}`, `exit code: ${timedOut ? `timed out after ${timeoutMs}ms` : code}`];
        if (stdout.trim()) parts.push(`stdout:\n${truncate(stdout).trimEnd()}`);
        if (stderr.trim()) parts.push(`stderr:\n${truncate(stderr).trimEnd()}`);
        if (stdoutChars > stdout.length || stderrChars > stderr.length) parts.push("[Output truncated; use a narrower command.]");
        const result = parts.join("\n");
        if (ctx.signal?.aborted) reject(ctx.signal.reason);
        else if (timedOut || code !== 0) reject(new Error(result));
        else resolvePromise(result);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", stop);
        reject(new Error(`Failed to spawn shell: ${e.message}`));
      });
    });
  },
};

/** Exported for tests. */
export { DANGEROUS_PATTERNS };