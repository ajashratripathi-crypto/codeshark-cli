import { ToolSchema } from "../provider/types.js";

export interface ToolContext {
  cwd: string;
  log?: (msg: string) => void;
  readOnly?: boolean;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  /** Only explicitly read-only tools may run in plan mode. */
  readOnly?: boolean;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string> | string;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

function bounded(text: string): string {
  return text.length > 30_000 ? text.slice(0, 30_000) + "\n[Output truncated; narrow the request or read a smaller window.]" : text;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  add(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  schemas(readOnly = false): ToolSchema[] {
    return [...this.tools.values()].filter((t) => !readOnly || t.readOnly).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `Unknown tool: ${name}. Available tools: ${this.names().join(", ")}`,
        isError: true,
      };
    }
    try {
      ctx.signal?.throwIfAborted();
      if (ctx.readOnly && !tool.readOnly) throw new Error("Plan mode is read-only. Switch to /build before changing files or running commands.");
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be a JSON object.");
      const required = tool.inputSchema.required as string[] | undefined;
      for (const key of required ?? []) {
        if (args[key] === undefined) throw new Error(`Missing required argument: ${key}`);
      }
      const properties = tool.inputSchema.properties as Record<string, { type?: string }> | undefined;
      for (const [key, value] of Object.entries(args)) {
        const type = properties?.[key]?.type;
        if (type === "string" && typeof value !== "string") throw new Error(`${key} must be a string.`);
        if (type === "integer" && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)) {
          throw new Error(`${key} must be a positive integer.`);
        }
      }
      const content = await tool.run(args, ctx);
      const text = String(content);
      return { content: bounded(text), isError: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: bounded(`Tool ${name} failed: ${msg}`), isError: true };
    }
  }
}
