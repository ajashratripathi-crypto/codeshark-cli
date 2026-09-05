import { createOpenAICompatClient } from "./openaiCompat.js";
import { ChatClient } from "./types.js";
import { CodeSharkConfig, effectiveModel } from "../config.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

export function createOllamaClient(cfg: CodeSharkConfig): ChatClient {
  const model = effectiveModel(cfg, "ollama");
  return createOpenAICompatClient({
    provider: "ollama",
    baseUrl: cfg.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL,
    model,
    isFree: true,
  });
}

/** Quick reachability check for the local Ollama server. */
export async function ollamaAvailable(cfg: CodeSharkConfig): Promise<boolean> {
  try {
    const res = await fetch(`${(cfg.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "")}/models`);
    return res.ok;
  } catch {
    return false;
  }
}