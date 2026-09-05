import { mkdirSync, readFileSync, statSync, writeFileSync, readdirSync, type Dirent } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { resolveProjectPath } from "../project.js";
import { Tool, ToolContext } from "./registry.js";

function resolvePath(p: unknown, cwd: string): string {
  const s = String(p ?? "").trim();
  if (!s) return cwd;
  return resolveProjectPath(s, cwd);
}

function prettyPath(p: string, cwd: string): string {
  const r = relative(cwd, p);
  return r && !r.startsWith("..") ? r : p;
}

const MAX_READ_BYTES = 10 * 1024 * 1024;
const MAX_LIST_ENTRIES = 300;
const MAX_GLOB_MATCHES = 200;

function looksBinary(text: string): boolean {
  return text.includes("\u0000");
}

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read a text file. Use offset (1-based line number) and limit (number of lines) to read large files in windows. Output is line-numbered.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, absolute or relative to the working directory." },
      offset: { type: "integer", description: "1-based starting line. Default 1." },
      limit: { type: "integer", description: "Max lines to return. Default: whole file." },
    },
    required: ["path"],
  },

  run(args, ctx) {
    const p = resolvePath(args.path, ctx.cwd);
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) throw new Error(`File not found: ${prettyPath(p, ctx.cwd)}`);
    if (st.isDirectory()) throw new Error(`${prettyPath(p, ctx.cwd)} is a directory — use list_directory instead.`);
    if (st.size > MAX_READ_BYTES) {
      throw new Error(
        `File is ${Math.round(st.size / 1024 / 1024)} MB — too large to read whole. Use offset/limit to page through it.`,
      );
    }
    const text = readFileSync(p, "utf8");
    if (looksBinary(text)) throw new Error(`File appears to be binary — refusing to read as text.`);

    const lines = text.split("\n");
    const start = args.offset ? Math.max(1, Number(args.offset)) : 1;
    const end = args.limit ? Math.min(lines.length, start + Number(args.limit) - 1) : lines.length;
    const body = lines
      .slice(start - 1, end)
      .map((line, i) => `${String(start + i).padStart(5)} | ${line}`)
      .join("\n");
    const trunc = end < lines.length ? `\n... (${lines.length - end} more lines; continue with offset=${end + 1})` : "";
    return `File: ${prettyPath(p, ctx.cwd)} (${lines.length} lines)\n${body}${trunc}`;
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Create a new file or overwrite an existing one with the given content. Creates parent directories. Use edit_file for surgical changes to existing files.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write." },
      content: { type: "string", description: "Full content of the file." },
    },
    required: ["path", "content"],
  },

  run(args, ctx) {
    const p = resolvePath(args.path, ctx.cwd);
    const content = String(args.content ?? "");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
    return `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${prettyPath(p, ctx.cwd)}.`;
  },
};

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Make a surgical change to an existing file: replace exactly one occurrence of oldString with newString. The oldString must match the file exactly (including whitespace) and appear exactly once, otherwise the edit is rejected — this prevents accidental corrupting edits.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to edit." },
      oldString: { type: "string", description: "The exact text to replace (must appear exactly once in the file)." },
      newString: { type: "string", description: "The replacement text." },
    },
    required: ["path", "oldString", "newString"],
  },

  run(args, ctx) {
    const p = resolvePath(args.path, ctx.cwd);
    const oldString = String(args.oldString ?? "");
    const newString = String(args.newString ?? "");
    if (!oldString) throw new Error("oldString must not be empty.");

    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) throw new Error(`File not found: ${prettyPath(p, ctx.cwd)}`);

    const text = readFileSync(p, "utf8");
    if (looksBinary(text)) throw new Error("File appears to be binary — refusing to edit as text.");

    let count = 0;
    let idx = -1;
    let from = 0;
    while (true) {
      const hit = text.indexOf(oldString, from);
      if (hit === -1) break;
      count++;
      if (idx === -1) idx = hit;
      from = hit + oldString.length;
    }

    if (count === 0) {
      throw new Error(
        `oldString not found in ${prettyPath(p, ctx.cwd)}. It must match the file exactly — check whitespace/indentation.`,
      );
    }
    if (count > 1) {
      throw new Error(
        `oldString matches ${count} times in ${prettyPath(p, ctx.cwd)}. Make it more specific (include surrounding lines).`,
      );
    }

    const next = text.slice(0, idx) + newString + text.slice(idx + oldString.length);
    writeFileSync(p, next, "utf8");
    const line = (text.slice(0, idx).match(/\n/g)?.length ?? 0) + 1;
    return `Edited ${prettyPath(p, ctx.cwd)} (line ${line}): replaced ${oldString.length} chars with ${newString.length} chars.`;
  },
};

export const listDirectoryTool: Tool = {
  name: "list_directory",
  description: "List the files and subdirectories in a directory. Directories are suffixed with '/'.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to list. Defaults to the working directory." },
    },
  },

  run(args, ctx) {
    const p = resolvePath(args.path, ctx.cwd);
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return `Directory not found: ${prettyPath(p, ctx.cwd)}`;
    if (!st.isDirectory()) return `${prettyPath(p, ctx.cwd)} is not a directory.`;

    const entries = readdirSync(p, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

    const shown = entries.slice(0, MAX_LIST_ENTRIES);
    const trunc = entries.length > MAX_LIST_ENTRIES ? `\n... (${entries.length - MAX_LIST_ENTRIES} more entries)` : "";
    return `Directory: ${prettyPath(p, ctx.cwd)} (${entries.length} entries)\n${shown.join("\n")}${trunc}`;
  },
};

/** Minimal glob → RegExp conversion supporting **, *, ?, and {a,b}. */
export function globToRegExp(glob: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // "**/" may match zero directories; bare "**" matches anything.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      re += "[^/]";
      i += 1;
    } else if (ch === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
        i += 1;
      } else {
        const alts = glob
          .slice(i + 1, end)
          .split(",")
          .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|");
        re += `(?:${alts})`;
        i = end + 1;
      }
    } else if (ch === "[") {
      const end = glob.indexOf("]", i);
      if (end === -1) {
        re += "\\[";
        i += 1;
      } else {
        re += glob.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(re + "$");
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "target", "vendor", "__pycache__"]);

function walkFiles(dir: string, out: string[], depth: number): void {
  if (depth > 12) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_GLOB_MATCHES) return;
    if (e.name.startsWith(".")) continue; // skip hidden
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(resolve(dir, e.name), out, depth + 1);
    } else if (e.isFile()) {
      out.push(resolve(dir, e.name));
    }
  }
}

export const globTool: Tool = {
  name: "glob",
  description:
    "Find files matching a glob pattern, e.g. \"src/**/*.ts\" or \"*.json\". Skips node_modules, .git, and hidden files by default.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern. Supports **, *, ?, and {a,b}." },
      cwd: { type: "string", description: "Directory to search from. Defaults to the working directory." },
    },
    required: ["pattern"],
  },

  run(args, ctx) {
    const pattern = String(args.pattern ?? "");
    if (!pattern) return "pattern is required.";
    const cwd = args.cwd ? resolvePath(args.cwd, ctx.cwd) : ctx.cwd;
    const staticPrefix = pattern.slice(0, pattern.indexOf("*"));
    const prefix = staticPrefix.split(/[\\/]/).slice(0, -1).join("/") || ".";
    const searchRoot = resolveProjectPath(prefix, cwd);
    if (!statSync(searchRoot, { throwIfNoEntry: false })?.isDirectory()) {
      return `No matches for ${pattern}`;
    }

    const all: string[] = [];
    walkFiles(searchRoot, all, 0);
    const rx = globToRegExp(pattern.replace(/\\/g, "/"));
    const matches = all
      .map((f) => relative(cwd, f).replace(/\\/g, "/"))
      .filter((f) => rx.test(f))
      .slice(0, MAX_GLOB_MATCHES);

    if (!matches.length) return `No matches for ${pattern}`;
    return `${matches.length} match${matches.length === 1 ? "" : "es"} for ${pattern}:\n${matches.join("\n")}`;
  },
};

export const finishTool: Tool = {
  name: "finish",
  description:
    "Signal that the task is complete. Call this with a short summary of what was done instead of answering in chat text.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentence summary of what was accomplished." },
    },
  },

  run(args) {
    const summary = String(args.summary ?? "").trim();
    return summary || "Task complete.";
  },
};

export const fileTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  globTool,
];