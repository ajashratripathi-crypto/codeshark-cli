import { CodeSharkConfig, DEFAULT_GATEWAY_URL, envApiKey } from "./config.js";
import { MODELS, type ModelInfo } from "./models.js";

export type ModelAvailability = "checking" | "available" | "unavailable";

const statuses = new Map<string, ModelAvailability>();
const reasons = new Map<string, string>();
const TIMEOUT_MS = 8_000;

export function modelAvailability(modelId: string): ModelAvailability {
  return statuses.get(modelId) ?? "checking";
}

export function modelAvailabilityReason(modelId: string): string | undefined {
  return reasons.get(modelId);
}

export function modelAvailabilitySnapshot(): Array<{ model: ModelInfo; status: ModelAvailability; reason?: string }> {
  return MODELS.map((model) => ({
    model,
    status: modelAvailability(model.id),
    reason: modelAvailabilityReason(model.id),
  }));
}

function endpointFor(model: ModelInfo, cfg: CodeSharkConfig): { url: string; key?: string } {
  if (model.provider === "gemini") {
    return {
      url: `${(cfg.geminiBaseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")}/models/${model.model}:generateContent`,
      key: cfg.geminiApiKey ?? envApiKey("gemini"),
    };
  }

  const key = cfg.unorouterApiKey ?? envApiKey("unorouter");
  if (key) {
    return { url: `${(cfg.unorouterBaseUrl ?? "https://api.unorouter.com/v1").replace(/\/+$/, "")}/chat/completions`, key };
  }
  return {
    url: `${(cfg.gatewayUrl ?? process.env.CODESHARK_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, "")}/v1/chat/completions`,
    key: cfg.gatewayKey ?? process.env.CODESHARK_GATEWAY_KEY,
  };
}

async function checkOne(model: ModelInfo, cfg: CodeSharkConfig): Promise<void> {
  const target = endpointFor(model, cfg);
  if (!target.key && model.provider === "gemini") {
    statuses.set(model.id, "unavailable");
    reasons.set(model.id, "GEMINI_API_KEY is not configured");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (target.key) headers.authorization = `Bearer ${target.key}`;
    if (model.provider === "gemini") {
      const url = `${target.url}?key=${encodeURIComponent(target.key ?? "")}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }] }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } else {
      const response = await fetch(target.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: model.model, messages: [{ role: "user", content: "Reply with OK." }], stream: false, max_tokens: 4 }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
    statuses.set(model.id, "available");
    reasons.delete(model.id);
  } catch (error) {
    statuses.set(model.id, "unavailable");
    reasons.set(model.id, error instanceof Error && error.name === "AbortError" ? "check timed out" : error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function checkModelAvailability(cfg: CodeSharkConfig): Promise<void> {
  for (const model of MODELS) {
    statuses.set(model.id, "checking");
    reasons.delete(model.id);
  }
  await Promise.all(MODELS.map((model) => checkOne(model, cfg)));
}
