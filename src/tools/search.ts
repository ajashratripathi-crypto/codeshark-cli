import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { resolveProjectPath } from "../project.js";
import { spawn } from "node:child_process";
import { Tool } from "./registry.js";

const MAX_RESULTS = 200;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "target", "vendor", "__pycache__"]);

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function exec(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: "spawn failed" });
    });
  });
}

function parseFlags(flags: string): { caseInsensitive: boolean; filesOnly: boolean; context: number; word: boolean } {
  return {
    caseInsensitive: /-i/.test(flags),
    filesOnly: /-l/.test(flags),
    word: /-w/.test(flags),
    context: (/-C\s*(\d+)/.exec(flags)?.[1] ? Number(/-C\s*(\d+)/.exec(flags)![1]) : 0) || 0,
  };
}

/** Dependency-free fallback when ripgrep isn't installed. */
function jsSearch(root: string, pattern: string, flags: string): string {
  const { caseInsensitive, filesOnly, context } = parseFlags(flags);
  let rx: RegExp;
  try {
    rx = new RegExp(pattern, caseInsensitive ? "i" : "");
  } catch {
    return `Invalid regex: ${pattern}`;
  }

  const results: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 12 || results.length >= MAX_RESULTS) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (e.name.startsWith(".")) continue;
      const full = resolveProjectPath(e.name, dir);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\u0000")) continue; // binary
      const rel = relative(root, full).replace(/\\/g, "/");
      const lines = text.split("\n");
      if (filesOnly) {
        if (lines.some((l) => rx.test(l))) results.push(rel);
        continue;
      }
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!rx.test(line)) continue;
        results.push(`${rel}:${i + 1}:${line.length > 240 ? line.slice(0, 240) + "…" : line}`);
        if (context > 0) {
          for (let c = 1; c <= context; c++) {
            const idx = i + c;
            if (idx < lines.length && results.length < MAX_RESULTS) {
              results.push(`${rel}:${idx + 1}:${lines[idx]!}`);
            }
          }
        }
      }
    }
  };
  walk(root, 0);
  return results.length ? results.join("\n") : `No matches for ${pattern} in ${relative(process.cwd(), root) || root}`;
}

export const codeSearchTool: Tool = {
  name: "code_search",
  description:
    "Search file contents with a regular expression (ripgrep if installed, a built-in fallback otherwise). Returns up to 200 matches with line numbers. Flags: -i case-insensitive, -l files only, -w whole word, -C n context lines.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for." },
      cwd: { type: "string", description: "Directory to search. Defaults to the working directory." },
      flags: { type: "string", description: "Optional flags: -i, -l, -w, -C n." },
    },
    required: ["pattern"],
  },

  async run(args, ctx) {
    const pattern = String(args.pattern ?? "");
    if (!pattern) return "pattern is required.";
    const cwd = args.cwd ? resolveProjectPath(String(args.cwd), ctx.cwd) : ctx.cwd;
    const flags = String(args.flags ?? "");
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return `Not a directory: ${cwd}`;

    // Prefer ripgrep; fall back to the JS implementation.
    const rg = await exec("rg", ["--version"], 3000);
    if (rg.code === 0) {
      const rgArgs = [
        "--line-number",
        "--no-heading",
        "--color",
        "never",
        "-m",
        String(MAX_RESULTS),
        "--max-columns",
        "240",
        ...(/-i/.test(flags) ? ["-i"] : []),
        ...(/-l/.test(flags) ? ["-l"] : []),
        ...(/-w/.test(flags) ? ["-w"] : []),
        ...(/-C\s*(\d+)/.test(flags) ? ["-C", /-C\s*(\d+)/.exec(flags)![1]!] : []),
        pattern,
        cwd,
      ];
      const res = await exec("rg", rgArgs, 15000);
      if (res.code === 0 || res.code === 1) {
        return res.stdout.trim() || `No matches for ${pattern}`;
      }
      if (res.code === 2) {
        return `rg error: ${res.stderr.trim().slice(0, 300) || "invalid regex or path"}`;
      }
    }
    return jsSearch(cwd, pattern, flags);
  },
};

/** Exported for tests. */
export { jsSearch, parseFlags };