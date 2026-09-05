import {
  ChatClient,
  ChatMessage,
  ProviderError,
  StreamEvents,
  ToolCall,
  classifyStatus,
  errorMessage,
} from "./types.js";

export interface OpenAICompatOptions {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  isFree?: boolean;
  fetchImpl?: typeof fetch;
  /** Delays (ms) to wait between retries when the API answers 429. Default [800, 1600]. */
  rateLimitRetryDelays?: number[];
}

function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    switch (m.role) {
      case "system":
      case "user":
        out.push({ role: m.role, content: m.content });
        break;
      case "assistant": {
        const msg: Record<string, unknown> = { role: "assistant", content: m.content };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }));
        }
        out.push(msg);
        break;
      }
      case "tool":
        out.push({ role: "tool", content: m.content, tool_call_id: m.toolCallId });
        break;
    }
  }
  return out;
}

function toOpenAITools(tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  args: string;
}

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createOpenAICompatClient(opts: OpenAICompatOptions): ChatClient {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const endpoint = `${base}/chat/completions`;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    provider: opts.provider,
    model: opts.model,
    isFree: opts.isFree ?? true,

    async chat(messages, tools, events, signal): Promise<ChatMessage> {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: toOpenAIMessages(messages),
        stream: true,
        temperature: 0.3,
      };
      if (tools.length) body.tools = toOpenAITools(tools);

      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        ...opts.extraHeaders,
      };

      // Wait out rate limits with backoff before surfacing a 429 — the
      // queue lives client-side too, so shared gateway lanes feel smooth.
      const retryDelays = opts.rateLimitRetryDelays ?? [800, 1600];
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        let candidate: Response;
        try {
          candidate = await fetchImpl(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
          });
        } catch (e) {
          throw new ProviderError(
            `Cannot reach ${opts.provider} at ${base}: ${errorMessage(e)}`,
            "network",
          );
        }
        if (candidate.status !== 429 || attempt >= retryDelays.length) {
          res = candidate;
          break;
        }
        await new Promise((r) => setTimeout(r, retryDelays[attempt]!));
      }

      if (!res.ok) {
        let detail = "";
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          detail = j.error?.message ?? JSON.stringify(j).slice(0, 300);
        } catch {
          detail = (await res.text().catch(() => "")).slice(0, 300);
        }
        throw classifyStatus(res.status, opts.provider, detail);
      }
      if (!res.body) {
        throw new ProviderError(`${opts.provider}: empty response body`, "unknown");
      }

      return parseOpenAIStream(res.body, opts.provider, events);
    },
  };
}

async function parseOpenAIStream(
  body: ReadableStream<Uint8Array>,
  provider: string,
  events?: StreamEvents,
): Promise<ChatMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const pending = new Map<number, AccumulatedToolCall>();
  const finalized = new Map<number, AccumulatedToolCall>();

  const handleData = (data: string): void => {
    if (!data || data === "[DONE]") return;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (json.error) {
      const err = json.error as { message?: string; code?: unknown };
      const status = typeof json.status === "number" ? json.status : 400;
      throw classifyStatus(status, provider, err.message ?? "stream error");
    }
    const choices = json.choices as
      | { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
      | undefined;
    const choice = choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};

    if (delta.content) {
      content += delta.content;
      events?.onText?.(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = pending.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        pending.set(idx, cur);
      }
    }
    if (choice.finish_reason) {
      for (const [idx, tc] of pending) finalized.set(idx, tc);
      pending.clear();
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) handleData(trimmed.slice(5).trim());
      }
    }
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) handleData(trimmed.slice(5).trim());
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`${provider}: stream interrupted: ${errorMessage(e)}`, "network");
  }

  const toolCalls: ToolCall[] = [...finalized.values()]
    .filter((c) => c.name)
    .map((c) => ({
      id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      name: c.name,
      args: safeParseArgs(c.args),
    }));

  return {
    role: "assistant",
    content: content.trim(),
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };
}

/** Exported for tests. */
export { toOpenAIMessages, toOpenAITools, safeParseArgs };