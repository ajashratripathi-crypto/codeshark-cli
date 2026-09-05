import { createOpenAICompatClient } from "./openaiCompat.js";
import { ChatClient } from "./types.js";
import { CodeSharkConfig, effectiveModel } from "../config.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** True when the model slug only targets free models on OpenRouter. */
export function isOpenRouterFreeModel(model: string): boolean {
  return model === "openrouter/free" || model.endsWith(":free");
}

export function createOpenRouterClient(cfg: CodeSharkConfig, apiKey: string): ChatClient {
  const model = effectiveModel(cfg, "openrouter");
  return createOpenAICompatClient({
    provider: "openrouter",
    baseUrl: cfg.openrouterBaseUrl ?? OPENROUTER_BASE_URL,
    model,
    apiKey,
    isFree: isOpenRouterFreeModel(model),
    extraHeaders: {
      "HTTP-Referer": "https://github.com/codeshark/codeshark",
      "X-Title": "CodeShark",
    },
  });
}