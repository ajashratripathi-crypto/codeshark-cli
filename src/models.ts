/**
 * The CodeShark model catalog.
 *
 * All five launch models run on UnoRouter (https://unorouter.com), a single
 * OpenAI-compatible endpoint that routes to many upstream providers. `id` is
 * the stable identifier stored in ~/.codeshark.json
 * (`"model": "unorouter/glm-5.3-flash-thinking"`); `model` is the raw slug
 * sent to the provider's API.
 */
export interface ModelInfo {
  id: string;
  label: string;
  provider: "openrouter" | "nvidia" | "unorouter";
  /** Raw model slug sent to the provider API. */
  model: string;
  /** Context window, human-readable. */
  context: string;
  notes: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: "unorouter/gpt-5.6-sol",
    label: "Chat-GPT 5.6 Sol",
    provider: "unorouter",
    model: "gpt-5.6-sol:free",
    context: "400K",
    notes: "OpenAI's frontier reasoning model.",
  },
  {
    id: "unorouter/deepseek-v4-flash",
    label: "DeepSeek-V4 Flash",
    provider: "unorouter",
    model: "deepseek-v4-flash-0731:free",
    context: "256K",
    notes: "DeepSeek's fast flash model, strong at code.",
  },
  {
    id: "unorouter/glm-5.3-flash-thinking",
    label: "GLM 5.3 Flash Thinking",
    provider: "unorouter",
    model: "glm-5.3-flash-thinking:free",
    context: "1M",
    notes: "Zhipu's reasoning coder with 1M context — the default.",
  },
  {
    id: "unorouter/kimi-k3",
    label: "Kimi-K3",
    provider: "unorouter",
    model: "kimi-k3:free",
    context: "256K",
    notes: "Moonshot's flagship coding model.",
  },
  {
    id: "unorouter/gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    provider: "unorouter",
    model: "gemini-3.6-flash:free",
    context: "1M",
    notes: "Google's fast flash model with a huge 1M context.",
  },
];

export const DEFAULT_MODEL_ID = "unorouter/glm-5.3-flash-thinking";

export function listModels(): ModelInfo[] {
  return [...MODELS];
}

export function findModel(idOrSlug: string): ModelInfo | undefined {
  const s = idOrSlug.trim();
  return MODELS.find((m) => m.id === s || m.model === s);
}

/** Map a catalog id (or raw slug) to the raw slug the provider API expects. */
export function toApiSlug(idOrSlug: string): string {
  return findModel(idOrSlug)?.model ?? idOrSlug;
}