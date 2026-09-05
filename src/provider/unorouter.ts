import { createOpenAICompatClient } from "./openaiCompat.js";
import { ChatClient } from "./types.js";
import { CodeSharkConfig, effectiveModel } from "../config.js";

export const UNOROUTER_BASE_URL = "https://api.unorouter.com/v1";

/**
 * True when the model slug only targets free models on UnoRouter.
 * UnoRouter's free lanes are OpenAI-compatible: one key, 200+ free models
 * behind `:free` slugs (https://unorouter.com).
 */
export function isUnoRouterFreeModel(model: string): boolean {
  return model === "unorouter/free" || model.endsWith(":free");
}

export function createUnoRouterClient(cfg: CodeSharkConfig, apiKey: string): ChatClient {
  const model = effectiveModel(cfg, "unorouter");
  return createOpenAICompatClient({
    provider: "unorouter",
    baseUrl: cfg.unorouterBaseUrl ?? UNOROUTER_BASE_URL,
    model,
    apiKey,
    isFree: isUnoRouterFreeModel(model),
    extraHeaders: {
      "HTTP-Referer": "https://github.com/codeshark/codeshark",
      "X-Title": "CodeShark",
    },
  });
}