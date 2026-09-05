import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAICompatClient, safeParseArgs } from "../dist/provider/openaiCompat.js";
import { toGeminiContents, toGeminiTools } from "../dist/provider/gemini.js";
import { globToRegExp } from "../dist/tools/files.js";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

test("openai-compat client parses streamed text", async () => {
  const client = createOpenAICompatClient({
    provider: "test",
    baseUrl: "https://example.test/v1",
    model: "m",
    fetchImpl: async () =>
      new Response(
        sseStream([
          'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
          // keep: content is "Hel" + "lo" = "Hello"
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200 },
      ),
  });

  let streamed = "";
  const msg = await client.chat([{ role: "user", content: "hi" }], [], { onText: (d) => (streamed += d) });
  assert.equal(msg.content, "Hello");
  assert.equal(msg.toolCalls, undefined);
  assert.equal(streamed, "Hello");
});

test("openai-compat client assembles streamed tool calls", async () => {
  const client = createOpenAICompatClient({
    provider: "test",
    baseUrl: "https://example.test/v1",
    model: "m",
    fetchImpl: async () =>
      new Response(
        sseStream([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200 },
      ),
  });

  const msg = await client.chat([{ role: "user", content: "read" }], []);
  assert.ok(msg.toolCalls, "should have tool calls");
  assert.equal(msg.toolCalls.length, 1);
  assert.equal(msg.toolCalls[0]!.name, "read_file");
  assert.deepEqual(msg.toolCalls[0]!.args, { path: "a.txt" });
});

test("openai-compat client classifies 429 as rate limit", async () => {
  const client = createOpenAICompatClient({
    provider: "test",
    baseUrl: "https://example.test/v1",
    model: "m",
    rateLimitRetryDelays: [],
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(client.chat([{ role: "user", content: "x" }], []), /rate limit/);
});

test("openai-compat client retries 429 with backoff, then succeeds", async () => {
  let calls = 0;
  const client = createOpenAICompatClient({
    provider: "test",
    baseUrl: "https://example.test/v1",
    model: "m",
    rateLimitRetryDelays: [1],
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        sseStream([
          'data: {"choices":[{"delta":{"content":"Retried"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200 },
      );
    },
  });
  const msg = await client.chat([{ role: "user", content: "hi" }], []);
  assert.equal(msg.content, "Retried");
  assert.equal(calls, 2);
});

test("safeParseArgs handles partial JSON", () => {
  assert.deepEqual(safeParseArgs('{"a":'), {});
  assert.deepEqual(safeParseArgs('{"a":1}'), { a: 1 });
});

test("gemini message conversion round-trips tools", () => {
  const messages = [
    { role: "system" as const, content: "be helpful" },
    { role: "user" as const, content: "hello" },
    {
      role: "assistant" as const,
      content: "",
      toolCalls: [{ id: "c1", name: "read_file", args: { path: "x.ts" } }],
    },
    { role: "tool" as const, content: "the file", toolCallId: "c1", toolName: "read_file" },
  ];
  const { system, contents } = toGeminiContents(messages);
  assert.equal(system, "be helpful");
  assert.equal(contents.length, 3);
  assert.equal(contents[0]!.role, "user");
  assert.equal(contents[1]!.role, "model");
  assert.equal(contents[1]!.parts[0]!.functionCall!.name, "read_file");
  assert.equal(contents[2]!.role, "user");
  assert.equal(contents[2]!.parts[0]!.functionResponse!.name, "read_file");
});

test("gemini tools convert to functionDeclarations", () => {
  const tools = [{ name: "read_file", description: "read", inputSchema: { type: "object", properties: {} } }];
  const converted = toGeminiTools(tools);
  assert.equal((converted[0] as { functionDeclarations: unknown[] }).functionDeclarations.length, 1);
});

test("globToRegExp handles **, *, and {a,b}", () => {
  assert.ok(globToRegExp("src/**/*.ts").test("src/a/b/c.ts"));
  assert.ok(globToRegExp("src/**/*.ts").test("src/a.ts"));
  assert.ok(!globToRegExp("src/**/*.ts").test("lib/a.ts"));
  assert.ok(globToRegExp("*.{json,md}").test("README.md"));
  assert.ok(!globToRegExp("*.{json,md}").test("README.txt"));
  assert.ok(globToRegExp("src/*.ts").test("src/a.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/deep/a.ts"));
});