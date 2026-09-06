import { ChatClient, ChatMessage, StreamEvents, ToolCall, errorMessage } from "./provider/types.js";
import { ToolRegistry, ToolContext } from "./tools/index.js";
import { defaultSystemPrompt } from "./system.js";
import { DEFAULT_MAX_ITERATIONS } from "./config.js";

export interface AgentOptions {
  clients: ChatClient[];
  registry: ToolRegistry;
  cwd: string;
  systemPrompt?: string;
  maxIterations?: number;
  debug?: (msg: string) => void;
  /** Prior conversation messages, used by the interactive REPL for memory. */
  initialMessages?: ChatMessage[];
  /** Called before each tool runs. Return false to deny the action. */
  approveToolCall?: (call: ToolCall) => Promise<boolean>;
  readOnly?: boolean;
  signal?: AbortSignal;
}

export interface AgentResult {
  /** Final assistant text. */
  text: string;
  /** Number of model round-trips used. */
  iterations: number;
  /** Text emitted through onText for the final assistant response. */
  streamedText?: string;
  /** Conversation history after this turn, for the next REPL turn. */
  history: ChatMessage[];
}

/**
 * Run the agent loop for one user prompt:
 * model → tool calls → execute → feed results back → … until the model
 * answers (or calls finish) without further tool calls.
 */
export async function runAgent(input: string, opts: AgentOptions, events?: StreamEvents): Promise<AgentResult> {
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) throw new Error("maxIterations must be a positive integer.");
  const messages: ChatMessage[] = opts.initialMessages ? [...opts.initialMessages] : [];
  const systemPrompt = opts.systemPrompt ?? defaultSystemPrompt(opts.cwd);
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex === -1) {
    messages.unshift({ role: "system", content: systemPrompt });
  } else {
    messages[systemIndex] = { role: "system", content: systemPrompt };
  }
  messages.push({ role: "user", content: input });

  const ctx: ToolContext = { cwd: opts.cwd, log: opts.debug, readOnly: opts.readOnly, signal: opts.signal };
  let lastError: Error | null = null;

  for (let i = 0; i < maxIterations; i++) {
    opts.signal?.throwIfAborted();
    let assistant: ChatMessage | null = null;
    let streamedText = "";
    for (const client of opts.clients) {
      let clientStreamedText = "";
      const clientEvents: StreamEvents | undefined = events
        ? {
            onText: (delta) => {
              clientStreamedText += delta;
              events.onText?.(delta);
            },
            onToolCall: events.onToolCall,
            onDebug: events.onDebug,
          }
        : undefined;
      try {
        assistant = await client.chat(messages, opts.registry.schemas(opts.readOnly), clientEvents, opts.signal);
        if (assistant.role !== "assistant") throw new Error("Provider returned a non-assistant response.");
        streamedText = clientStreamedText;
        break;
      } catch (e) {
        assistant = null;
        opts.signal?.throwIfAborted();
        // A partial answer is already visible; avoid mixing it with another provider's answer.
        if (clientStreamedText) throw e;
        lastError = e instanceof Error ? e : new Error(String(e));
        opts.debug?.(`[provider] ${client.provider} failed: ${lastError.message}`);
      }
    }
    if (!assistant) {
      throw lastError ?? new Error("No provider available.");
    }
    const assistantMsg = assistant as Extract<ChatMessage, { role: "assistant" }>;
    messages.push(assistantMsg);

    const calls = assistantMsg.toolCalls ?? [];
    if (!calls.length) {
      return {
        text: assistantMsg.content,
        iterations: i + 1,
        streamedText: streamedText || undefined,
        history: messages,
      };
    }

    for (const call of calls) {
      opts.signal?.throwIfAborted();
      if (call.name === "finish") {
        const summary = typeof call.args.summary === "string" && call.args.summary.trim() ? call.args.summary.trim() : "Task complete.";
        const remaining = calls.slice(calls.indexOf(call));
        for (const pending of remaining) {
          messages.push({ role: "tool", content: pending === call ? summary : "Skipped because the task was finished.", toolCallId: pending.id, toolName: pending.name });
        }
        messages.push({ role: "assistant", content: summary });
        return { text: summary, iterations: i + 1, history: messages };
      }
      opts.debug?.(`[tool] ${call.name}`);
      events?.onToolCall?.(call);
      if (opts.approveToolCall && !(await opts.approveToolCall(call))) {
        messages.push({
          role: "tool",
          content: `User denied the requested action: ${call.name}. Do not retry it unless the user asks again.`,
          toolCallId: call.id,
          toolName: call.name,
          isError: true,
        });
        continue;
      }
      const result = await opts.registry.execute(call.name, call.args, ctx);
      messages.push({
        role: "tool",
        content: result.content,
        toolCallId: call.id,
        toolName: call.name,
        isError: result.isError,
      });
    }
  }

  throw new Error(
    `Agent exceeded ${maxIterations} iterations without finishing. The model may be looping on tool calls — try rephrasing, or set a higher maxIterations in ~/.codeshark.json.`,
  );
}

export { errorMessage };
