/**
 * The CodeShark model catalog.
 *
 * Most current catalog models run on the shared OpenAI-compatible gateway. `id` is
 * the stable identifier stored in ~/.codeshark.json
 * (`"model": "unorouter/glm-5.3-flash-think-search"`); `model` is the raw slug
 * sent to the provider's API.
 */
export interface ModelInfo {
  id: string;
  label: string;
  provider: "openrouter" | "unorouter" | "gemini";
  /** Raw model slug sent to the provider API. */
  model: string;
  /** Context window, human-readable. */
  context: string;
  notes: string;
  available?: boolean;
}

export const MODELS: ModelInfo[] = [
  {
    id: "unorouter/glm-5.3-flash-think-search",
    label: "GLM 5.3 Flash Think Search",
    provider: "unorouter",
    model: "glm-5.3-flash-think-search:free",
    context: "1M",
    notes: "Reasoning model with search-oriented thinking.",
  },
  {
    id: "unorouter/gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    provider: "unorouter",
    model: "gemini-3.6-flash:free",
    context: "1M",
    notes: "Fast long-context model for large codebases.",
  },
  {
    id: "unorouter/nemotron-3-ultra-550b-a55b",
    label: "Nemotron 3 Ultra 550B A55B",
    provider: "unorouter",
    model: "nemotron-3-ultra-550b-a55b:free",
    context: "256K",
    notes: "Large-scale open model for deep reasoning.",
  },
  {
    id: "unorouter/minimax-m2.7",
    label: "MiniMax M2.7",
    provider: "unorouter",
    model: "minimax-m2.7:free",
    context: "128K",
    notes: "Fast general-purpose coding and reasoning.",
  },
];

export const RETIRED_MODELS: ModelInfo[] = [
  { id: "gemini/gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "gemini", model: "gemini-3.8-flash", context: "-", notes: "Removed from the catalog.", available: false },
  { id: "unorouter/glm-5.3-flash-thinking", label: "GLM 5.3 Flash Thinking", provider: "unorouter", model: "glm-5.3-flash-thinking:free", context: "-", notes: "Removed from UnoRouter.", available: false },
  { id: "unorouter/kimi-k3", label: "Kimi-K3", provider: "unorouter", model: "kimi-k3:free", context: "-", notes: "Removed from UnoRouter.", available: false },
  { id: "unorouter/gpt-5.6-sol", label: "Chat-GPT 5.6 Sol", provider: "unorouter", model: "gpt-5.6-sol:free", context: "-", notes: "Removed from the catalog.", available: false },
  { id: "unorouter/deepseek-v4-flash", label: "DeepSeek-V4 Flash", provider: "unorouter", model: "deepseek-v4-flash:free", context: "-", notes: "Removed from the catalog.", available: false },
  { id: "unorouter/minimax-m3", label: "MiniMax M3", provider: "unorouter", model: "minimax-m3:free", context: "-", notes: "Replaced by MiniMax M2.7.", available: false },
  { id: "unorouter/sarvam-30b", label: "Sarvam 30B", provider: "unorouter", model: "sarvam-30b:free", context: "-", notes: "Shut down by the provider.", available: false },
  { id: "unorouter/gpt-oss-120b", label: "GPT-OSS 120B", provider: "unorouter", model: "gpt-oss-120b:free", context: "-", notes: "Removed from the catalog.", available: false },
];

export const DEFAULT_MODEL_ID = "unorouter/glm-5.3-flash-think-search";

export function listModels(): ModelInfo[] {
  return [...MODELS];
}

export function isRetiredModel(idOrSlug: string): boolean {
  const s = idOrSlug.trim();
  return RETIRED_MODELS.some((m) => m.id === s || m.model === s);
}

export function findModel(idOrSlug: string): ModelInfo | undefined {
  const s = idOrSlug.trim();
  return [...MODELS, ...RETIRED_MODELS].find((m) => m.id === s || m.model === s);
}

/** Map a catalog id (or raw slug) to the raw slug the provider API expects. */
export function toApiSlug(idOrSlug: string): string {
  return findModel(idOrSlug)?.model ?? idOrSlug;
}
