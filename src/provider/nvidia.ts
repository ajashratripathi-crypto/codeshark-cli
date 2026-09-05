import { createOpenAICompatClient } from "./openaiCompat.js";
import { ChatClient } from "./types.js";
import { CodeSharkConfig, effectiveModel } from "../config.js";
import { toApiSlug } from "../models.js";

export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * NVIDIA NIM hosts open models (DeepSeek, Kimi, GLM, Nemotron, …) behind a
 * free, OpenAI-compatible API. Get a key at https://build.nvidia.com —
 * no credit card, keys start with `nvapi-`.
 */
export function createNvidiaClient(cfg: CodeSharkConfig, apiKey: string): ChatClient {
  const model = toApiSlug(effectiveModel(cfg, "nvidia"));
  return createOpenAICompatClient({
    provider: "nvidia",
    baseUrl: cfg.nvidiaBaseUrl ?? DEFAULT_NVIDIA_BASE_URL,
    model,
    apiKey,
    isFree: true,
  });
}
