import { activeModelId, activeProvider, CodeSharkConfig, envApiKey } from "../config.js";
import { createGatewayClient } from "./gateway.js";
import { createGeminiClient } from "./gemini.js";
import { createOllamaClient } from "./ollama.js";
import { createOpenRouterClient } from "./openrouter.js";
import { createUnoRouterClient } from "./unorouter.js";
import { ChatClient } from "./types.js";
import { findModel } from "../models.js";

/**
 * Build the ordered list of ChatClients for this machine:
 * the active model's provider first, then automatic free fallbacks
 * (any other configured keys, then the zero-setup community gateway).
 */
export function resolveClients(cfg: CodeSharkConfig, debug?: (msg: string) => void): ChatClient[] {
  const clients: ChatClient[] = [];
  const add = (c: ChatClient) => {
    if (!clients.some((x) => x.provider === c.provider)) clients.push(c);
  };
  const has = (provider: string) => clients.some((c) => c.provider === provider);

  const primary = activeProvider(cfg);
  const selectedModel = activeModelId(cfg);
  switch (primary) {
    case "openrouter": {
      const key = cfg.openrouterApiKey ?? envApiKey("openrouter");
      // With no key, an OpenRouter model still runs through the gateway.
      if (key) add(createOpenRouterClient(cfg, key));
      else add(createGatewayClient(cfg));
      break;
    }
    case "unorouter": {
      const key = cfg.unorouterApiKey ?? envApiKey("unorouter");
      // With no key, an UnoRouter model still runs through the gateway
      // (the gateway holds the free UnoRouter key server-side).
      if (key) add(createUnoRouterClient(cfg, key));
      else add(createGatewayClient(cfg));
      break;
    }
    case "gemini": {
      const key = cfg.geminiApiKey ?? envApiKey("gemini");
      if (key) add(createGeminiClient(cfg, key));
      else debug?.("No Gemini API key env found (GEMINI_API_KEY) — will fall back.");
      break;
    }
    case "ollama":
      add(createOllamaClient(cfg));
      break;
    case "gateway":
    default:
      add(createGatewayClient(cfg));
      break;
  }

  // UnoRouter catalog selections must not silently become a different model
  // through another provider's fallback chain.
  if (selectedModel.startsWith("unorouter/") || findModel(selectedModel)) return clients;

  // Automatic free fallbacks, deduped: any other provider you have a key for.
  if (!has("openrouter")) {
    const key = cfg.openrouterApiKey ?? envApiKey("openrouter");
    if (key) add(createOpenRouterClient(cfg, key));
  }
  if (!has("unorouter")) {
    const key = cfg.unorouterApiKey ?? envApiKey("unorouter");
    if (key) add(createUnoRouterClient(cfg, key));
  }
  if (!has("gemini")) {
    const key = cfg.geminiApiKey ?? envApiKey("gemini");
    if (key) add(createGeminiClient(cfg, key));
  }
  if (!has("ollama") && (cfg.ollamaBaseUrl || process.env.CODESHARK_OLLAMA_URL)) {
    add(createOllamaClient(cfg));
  }
  if (!has("gateway") && primary !== "ollama") {
    add(createGatewayClient(cfg));
  }

  return clients;
}

export { ChatClient } from "./types.js";
export type { ChatMessage, StreamEvents, ToolCall, ToolSchema } from "./types.js";
