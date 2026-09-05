import { createOpenAICompatClient } from "./openaiCompat.js";
import { ChatClient } from "./types.js";
import { CodeSharkConfig, DEFAULT_GATEWAY_URL, effectiveModel } from "../config.js";

/**
 * The community gateway gives CodeShark its "works out of the box" default:
 * end users need no API key. The gateway (see worker/) holds keys server-side
 * and enforces `:free` lanes only. Fork the repo and deploy your own gateway,
 * then point CODESHARK_CONFIG / gatewayUrl at it.
 */
export function createGatewayClient(cfg: CodeSharkConfig): ChatClient {
  const base = cfg.gatewayUrl ?? process.env.CODESHARK_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
  const model = effectiveModel(cfg, "gateway");
  return createOpenAICompatClient({
    provider: "gateway",
    baseUrl: base,
    model,
    apiKey: cfg.gatewayKey ?? process.env.CODESHARK_GATEWAY_KEY,
    isFree: true,
  });
}