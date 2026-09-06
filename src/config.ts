import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MODEL_ID, findModel, isRetiredModel, toApiSlug } from "./models.js";

export type ProviderName = "gateway" | "openrouter" | "nvidia" | "gemini" | "ollama" | "unorouter";

/** User configuration, stored at ~/.codeshark.json (overridable via CODESHARK_CONFIG). */
export interface CodeSharkConfig {
  /** Primary provider. Defaults to "gateway" (zero-setup community gateway). */
  provider?: ProviderName;
  /**
   * Model selection. Prefer a catalog id like "unorouter/glm-5.3-flash-thinking"
   * or "unorouter/kimi-k3"; a raw provider slug also works.
   */
  model?: string;
  openrouterApiKey?: string;
  /** Optional custom base URL for the OpenRouter-compatible endpoint. */
  openrouterBaseUrl?: string;
  /** UnoRouter API key (https://unorouter.com) — unlocks 200+ models. */
  unorouterApiKey?: string;
  /** Optional custom base URL for the UnoRouter-compatible endpoint. */
  unorouterBaseUrl?: string;
  nvidiaApiKey?: string;
  /** Optional custom base URL for the NVIDIA NIM endpoint. */
  nvidiaBaseUrl?: string;
  geminiApiKey?: string;
  /** Optional custom base URL for the Gemini API. */
  geminiBaseUrl?: string;
  /** Community gateway base URL. Defaults to the built-in one. */
  gatewayUrl?: string;
  /** Optional key if a fork of the gateway requires one. */
  gatewayKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  /** Custom system prompt for the agent. */
  systemPrompt?: string;
  /** Max agent loop iterations per request. */
  maxIterations?: number;
  /** Set to true after the user accepts the Terms of Service once. */
  termsAccepted?: boolean;
  /** Set after the first-run provider setup has been shown once. */
  setupCompleted?: boolean;
}

export const DEFAULT_GATEWAY_URL = "https://codeshark-gateway.ajrgp.workers.dev";

/** Kept for backwards compatibility; the catalog in src/models.ts is canonical. */
export const DEFAULT_MODEL = "glm-5.3-flash-think-search:free";
/** Fallback slug for OpenRouter when the active model lives on another provider. */
export const DEFAULT_OPENROUTER_MODEL = "z-ai/glm-5.2:free";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
export const GEMINI_FLASH_MODEL = "gemini-2.5-flash";
export const DEFAULT_OLLAMA_MODEL = "qwen3-coder:30b";
export const DEFAULT_MAX_ITERATIONS = 25;

export function configPath(): string {
  return process.env.CODESHARK_CONFIG ?? join(homedir(), ".codeshark.json");
}

export function loadConfig(): CodeSharkConfig {
  const p = configPath();
  try {
    if (!existsSync(p)) return {};
    const raw = readFileSync(p, "utf8");
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const cfg = parsed as CodeSharkConfig;
    if (cfg.maxIterations !== undefined && (!Number.isSafeInteger(cfg.maxIterations) || cfg.maxIterations < 1)) delete cfg.maxIterations;
    const strings = ["model", "systemPrompt", "openrouterApiKey", "openrouterBaseUrl", "unorouterApiKey", "unorouterBaseUrl", "nvidiaApiKey", "nvidiaBaseUrl", "geminiApiKey", "geminiBaseUrl", "gatewayUrl", "gatewayKey", "ollamaBaseUrl", "ollamaModel"] as const;
    for (const key of strings) if (cfg[key] !== undefined && typeof cfg[key] !== "string") delete cfg[key];
    for (const key of ["termsAccepted", "setupCompleted"] as const) if (typeof cfg[key] !== "boolean") delete cfg[key];
    if (cfg.provider && !["gateway", "openrouter", "nvidia", "gemini", "ollama", "unorouter"].includes(cfg.provider)) delete cfg.provider;
    return cfg;
  } catch {
    return {};
  }
}

/** Persist config, creating the directory and locking file permissions (POSIX only). */
export function saveConfig(cfg: CodeSharkConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  const temporary = p + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify(cfg, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, p);
  } finally {
    try { unlinkSync(temporary); } catch { /* Already renamed, or never created. */ }
  }
  try {
    chmodSync(p, 0o600);
  } catch {
    // Windows: chmod is a no-op / may throw — ignore.
  }
}

/**
 * The effective model *catalog id* (e.g. "unorouter/glm-5.3-flash-thinking").
 * Falls back sensibly when config/env only name a provider.
 */
export function activeModelId(cfg: CodeSharkConfig): string {
  if (process.env.CODESHARK_MODEL && !isRetiredModel(process.env.CODESHARK_MODEL)) return process.env.CODESHARK_MODEL;
  if (cfg.model && !isRetiredModel(cfg.model)) return cfg.model;
  return DEFAULT_MODEL_ID;
}

/** Raw provider-API slug for the active model. */
export function activeApiModel(cfg: CodeSharkConfig): string {
  return toApiSlug(activeModelId(cfg));
}

/** The provider implied by the active model selection (or explicit config). */
export function activeProvider(cfg: CodeSharkConfig): ProviderName {
  const m = activeModelId(cfg);
  const entry = findModel(m);
  if (entry) return entry.provider;
  const explicit = cfg.provider;
  if (explicit) return explicit;
  // Slug heuristics for raw slugs not in the catalog.
  if (m.startsWith("unorouter/")) return "unorouter";
  if (m.endsWith(":free") || m.startsWith("openrouter/")) return "openrouter";
  if (m.startsWith("moonshotai/") || m.startsWith("deepseek-ai/")) return "nvidia";
  return "gateway";
}

/** Effective model for a provider, honoring env overrides and config. */
export function effectiveModel(cfg: CodeSharkConfig, provider: ProviderName): string {
  if (provider === "gemini") {
    const selected = findModel(activeModelId(cfg));
    const configured = selected?.provider === "gemini" ? selected.model : cfg.model && !selected ? cfg.model : undefined;
    return process.env.GEMINI_MODEL ?? configured ?? DEFAULT_GEMINI_MODEL;
  }
  if (provider === "ollama") return process.env.CODESHARK_OLLAMA_MODEL ?? cfg.ollamaModel ?? DEFAULT_OLLAMA_MODEL;

  const selected = findModel(activeModelId(cfg));
  if (selected?.provider === provider) return selected.model;
  // The community gateway proxies UnoRouter/OpenRouter models, so preserve
  // the selected model instead of silently falling back to GLM.
  if (provider === "gateway" && (selected?.provider === "openrouter" || selected?.provider === "unorouter")) return selected.model;
  if (provider === "unorouter") return process.env.UNOROUTER_MODEL ?? DEFAULT_MODEL;
  if (provider === "openrouter") return DEFAULT_OPENROUTER_MODEL;
  if (provider === "nvidia") {
    const raw = activeModelId(cfg);
    if (raw.startsWith("moonshotai/") || raw.startsWith("deepseek-ai/")) return raw;
    return "moonshotai/kimi-k3";
  }
  return DEFAULT_MODEL;
}

export function envApiKey(provider: ProviderName): string | undefined {
  switch (provider) {
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    case "unorouter":
      return process.env.UNOROUTER_API_KEY;
    case "nvidia":
      return process.env.NVIDIA_API_KEY ?? process.env.NVIDIA_NIM_API_KEY;
    case "gemini":
      return process.env.GEMINI_API_KEY;
    default:
      return undefined;
  }
}

export function hasApiKey(cfg: CodeSharkConfig, provider: ProviderName): boolean {
  if (provider === "gateway") return true;
  if (provider === "ollama") return true;
  return Boolean(cfg[`${provider}ApiKey` as "openrouterApiKey" | "unorouterApiKey" | "nvidiaApiKey" | "geminiApiKey"]) || Boolean(envApiKey(provider));
}

/** Short human label for the banner's model line — just the model, no provider branding. */
export function modelLabel(cfg: CodeSharkConfig): string {
  const id = activeModelId(cfg);
  return findModel(id)?.label ?? id;
}
