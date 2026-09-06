/**
 * Canonical message/tool types shared across every provider adapter.
 * Adapters convert between this format and their own wire format.
 */

export type Role = "system" | "user" | "assistant";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; toolName?: string; isError?: boolean };

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Callbacks fired while a response streams in. */
export interface StreamEvents {
  onText?: (delta: string) => void;
  onToolCall?: (call: ToolCall) => void;
  /** Fired after a tool finishes executing, with the tool's name. */
  onToolResult?: (toolName: string) => void;
  onDebug?: (msg: string) => void;
}

export interface ChatClient {
  readonly provider: string;
  readonly model: string;
  /** True when this client only ever talks to free endpoints. */
  readonly isFree: boolean;
  /**
   * Send messages + tools, stream events, and resolve to the final assistant
   * message (which may contain toolCalls for the agent loop to execute).
   */
  chat(
    messages: ChatMessage[],
    tools: ToolSchema[],
    events?: StreamEvents,
    signal?: AbortSignal,
  ): Promise<ChatMessage>;
}

export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "network"
  | "model"
  | "server"
  | "unknown";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(message: string, kind: ProviderErrorKind = "unknown", status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Best-effort mapping of HTTP status codes to a friendly error kind. */
export function classifyStatus(status: number, provider: string, detail?: string): ProviderError {
  switch (status) {
    case 401:
    case 403:
      return new ProviderError(
        `${provider}: authentication failed${detail ? ` (${detail})` : ""}. Check your API key (run \`codeshark setup\`).`,
        "auth",
        status,
      );
    case 404:
    case 400:
      return new ProviderError(
        `${provider}: model or request rejected${detail ? ` (${detail})` : ""}. Try \`codeshark model\` to see the active model.`,
        "model",
        status,
      );
    case 429:
      return new ProviderError(
        `${provider}: rate limit hit on shared lanes — wait a moment or add your own key (run \`codeshark setup\`).`,
        "rate_limit",
        status,
      );
    default:
      if (status >= 500) {
        return new ProviderError(`${provider}: server error (${status}). Try again shortly.`, "server", status);
      }
      return new ProviderError(`${provider}: request failed (${status})${detail ? `: ${detail}` : ""}.`, "unknown", status);
  }
}