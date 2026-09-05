import { ToolSchema } from "../provider/types.js";

export interface ToolContext {
  cwd: string;
  log?: (msg: string) => void;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string> | string;
}

export interface ToolResult {
  content: string;
  isError: boolean;
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

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => ({
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
      const content = await tool.run(args, ctx);
      return { content: String(content), isError: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: `Tool ${name} failed: ${msg}`, isError: true };
    }
  }
}