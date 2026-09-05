import { ToolRegistry } from "./registry.js";
import { fileTools, finishTool } from "./files.js";
import { codeSearchTool } from "./search.js";
import { runCommandTool } from "./shell.js";

/** Build the standard CodeShark toolset (working dir comes per-call via ToolContext). */
export function createRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  for (const t of fileTools) reg.add(t);
  reg.add(codeSearchTool);
  reg.add(runCommandTool);
  reg.add(finishTool);
  return reg;
}

export { ToolRegistry, ToolContext } from "./registry.js";
export type { Tool, ToolResult } from "./registry.js";
export { isDangerousCommand } from "./shell.js";