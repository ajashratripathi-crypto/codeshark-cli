import {
  ChatClient,
  ChatMessage,
  ProviderError,
  StreamEvents,
  ToolCall,
  ToolSchema,
  classifyStatus,
  errorMessage,
} from "./types.js";
import { CodeSharkConfig, effectiveModel } from "../config.js";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: string; isError?: boolean } };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function toGeminiContents(messages: ChatMessage[]): { system?: string; contents: GeminiContent[] } {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const m of messages) {
    switch (m.role) {
      case "system":
        systemParts.push(m.content);
        break;
      case "user":
        contents.push({ role: "user", parts: [{ text: m.content }] });
        break;
      case "assistant": {
        const parts: GeminiPart[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls ?? []) {
          parts.push({ functionCall: { name: tc.name, args: tc.args } });
        }
        contents.push({ role: "model", parts });
        break;
      }
      case "tool": {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: m.toolName ?? "unknown",
                response: { result: m.content, isError: m.isError ?? false },
              },
            },
          ],
        });
        break;
      }
    }
  }
  return { system: systemParts.join("\n\n") || undefined, contents };
}

function toGeminiTools(tools: ToolSchema[]): unknown[] {
  if (!tools.length) return [];
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

export function createGeminiClient(cfg: CodeSharkConfig, apiKey: string): ChatClient {
  const model = effectiveModel(cfg, "gemini");
  const base = cfg.geminiBaseUrl ?? GEMINI_BASE_URL;
  const endpoint = `${base.replace(/\/+$/, "")}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  return {
    provider: "gemini",
    model,
    isFree: true,

    async chat(messages, tools, events, signal): Promise<ChatMessage> {
      const { system, contents } = toGeminiContents(messages);
      const body: Record<string, unknown> = {
        contents,
        generationConfig: { temperature: 0.3 },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const gTools = toGeminiTools(tools);
      if (gTools.length) body.tools = gTools;

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        throw new ProviderError(`Cannot reach gemini: ${errorMessage(e)}`, "network");
      }

      if (!res.ok) {
        let detail = "";
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          detail = j.error?.message ?? "";
        } catch {
          // ignore
        }
        throw classifyStatus(res.status, "gemini", detail);
      }
      if (!res.body) throw new ProviderError("gemini: empty response body", "unknown");

      return parseGeminiStream(res.body, model, events);
    },
  };
}

async function parseGeminiStream(
  body: ReadableStream<Uint8Array>,
  model: string,
  events?: StreamEvents,
): Promise<ChatMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolCalls: ToolCall[] = [];
  let truncated = false;

  const handleData = (data: string): void => {
    if (!data) return;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (json.error) {
      const err = json.error as { message?: string; code?: unknown };
      const status = typeof json.code === "number" ? json.code : 400;
      throw classifyStatus(status, "gemini", err.message ?? "stream error");
    }
    const candidates = json.candidates as
      | { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
      | undefined;
    const candidate = candidates?.[0];
    if (!candidate?.content) return;

    for (const part of candidate.content.parts ?? []) {
      if (part.text) {
        text += part.text;
        events?.onText?.(part.text);
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `fc_${part.functionCall.name}_${toolCalls.length}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
        });
      }
    }
    if (candidate.finishReason === "MAX_TOKENS") truncated = true;
    if (candidate.finishReason === "SAFETY") {
      throw new ProviderError("gemini: response blocked by safety filter", "unknown");
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
    throw new ProviderError(`gemini: stream interrupted: ${errorMessage(e)}`, "network");
  }

  if (truncated) {
    events?.onDebug?.(`gemini: response hit MAX_TOKENS and was truncated.`);
  }

  return {
    role: "assistant",
    content: text.trim(),
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };
}

/** Exported for tests. */
export { toGeminiContents, toGeminiTools };