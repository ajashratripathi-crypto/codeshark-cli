import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read the bundled TERMS.md (shipped in the npm package next to dist/). */
export function readTerms(): string {
  try {
    return readFileSync(fileURLToPath(new URL("../TERMS.md", import.meta.url)), "utf8");
  } catch {
    return [
      "CodeShark Terms of Service",
      "",
      "CodeShark is provided AS IS, without warranty of any kind.",
      "The shared gateway is a free, best-effort service with rate limits and queues.",
      "You are responsible for your prompts, your files, and the commands you run.",
      "See TERMS.md in the repository or package for the full terms.",
    ].join("\n");
  }
}