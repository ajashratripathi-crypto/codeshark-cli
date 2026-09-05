import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../dist/agent.js";
import { createRegistry } from "../dist/tools/index.js";
import type { ChatClient, ChatMessage } from "../dist/provider/types.js";

class MockClient implements ChatClient {
  provider = "mock";
  model = "mock-1";
  isFree = true;
  seen: ChatMessage[][] = [];
  private responses: ChatMessage[];

  constructor(responses: ChatMessage[]) {
    this.responses = responses;
  }

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    this.seen.push(structuredClone(messages));
    const r = this.responses.shift();
    if (!r) throw new Error("mock exhausted");
    return r;
  }
}

class StreamingMockClient implements ChatClient {
  provider = "mock-stream";
  model = "mock-stream-1";
  isFree = true;

  async chat(_messages: ChatMessage[], _tools: unknown[], events?: { onText?: (delta: string) => void }): Promise<ChatMessage> {
    events?.onText?.("Hello from the model.");
    return { role: "assistant", content: "Hello from the model." };
  }
}

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "codeshark-test-"));
}

test("agent executes tool calls and returns the final answer", async () => {
  const dir = tempProject();
  writeFileSync(join(dir, "hello.txt"), "shark content\nline two\n");
  const client = new MockClient([
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "read_file", args: { path: "hello.txt" } }],
    },
    { role: "assistant", content: "The file says shark content." },
  ]);
  const result = await runAgent("What's in hello.txt?", {
    clients: [client],
    registry: createRegistry(),
    cwd: dir,
  });
  assert.equal(result.text, "The file says shark content.");
  // The tool result must have been fed back to the model.
  const secondCall = client.seen[1]!;
  const toolMsg = secondCall.find((m) => m.role === "tool");
  assert.ok(toolMsg, "a tool result message should be fed back");
  assert.ok(toolMsg.content.includes("shark content"));
  assert.equal(secondCall.filter((m) => m.role === "tool").length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("agent replaces the previous system prompt when a mode changes", async () => {
  const dir = tempProject();
  const client = new MockClient([{ role: "assistant", content: "planned" }]);
  await runAgent("continue", {
    clients: [client],
    registry: createRegistry(),
    cwd: dir,
    systemPrompt: "BUILD mode",
    initialMessages: [{ role: "system", content: "PLAN mode" }],
  });
  assert.equal(client.seen[0]![0]!.content, "BUILD mode");
  rmSync(dir, { recursive: true, force: true });
});

test("agent asks for approval before executing tools", async () => {
  const dir = tempProject();
  const client = new MockClient([
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", args: { path: "missing.txt" } }] },
    { role: "assistant", content: "The action was denied." },
  ]);
  const approvals: string[] = [];
  await runAgent("inspect the file", {
    clients: [client],
    registry: createRegistry(),
    cwd: dir,
    approveToolCall: async (call) => {
      approvals.push(call.name);
      return false;
    },
  });
  assert.deepEqual(approvals, ["read_file"]);
  assert.match(client.seen[1]!.find((message) => message.role === "tool")?.content ?? "", /denied/);
  rmSync(dir, { recursive: true, force: true });
});

test("streamed final text is reported once and is not duplicated by callers", async () => {
  const dir = tempProject();
  let output = "";
  const result = await runAgent(
    "say hello",
    { clients: [new StreamingMockClient()], registry: createRegistry(), cwd: dir },
    { onText: (delta) => (output += delta) },
  );
  assert.equal(output, "Hello from the model.");
  assert.equal(result.streamedText, "Hello from the model.");
  // REPL/CLI use this branch: they add only a newline, never result.text again.
  const displayed = output + (result.streamedText?.endsWith("\\n") ? "" : "\\n");
  assert.equal(displayed, "Hello from the model.\\n");
  rmSync(dir, { recursive: true, force: true });
});

test("finish tool short-circuits with its summary", async () => {
  const dir = tempProject();
  const client = new MockClient([
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "finish", args: { summary: "All done!" } }],
    },
  ]);
  const result = await runAgent("Do a thing", { clients: [client], registry: createRegistry(), cwd: dir });
  assert.equal(result.text, "All done!");
  rmSync(dir, { recursive: true, force: true });
});

test("agent stops after maxIterations if the model loops", async () => {
  const dir = tempProject();
  const looping = new MockClient([
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "glob", args: { pattern: "*.txt" } }] },
    { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "glob", args: { pattern: "*.txt" } }] },
    { role: "assistant", content: "", toolCalls: [{ id: "c3", name: "glob", args: { pattern: "*.txt" } }] },
    { role: "assistant", content: "finally done" },
  ]);
  await assert.rejects(
    runAgent("loop forever", { clients: [looping], registry: createRegistry(), cwd: dir, maxIterations: 3 }),
    /exceeded 3 iterations/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("edit_file rejects missing and ambiguous oldString", async () => {
  const dir = tempProject();
  const file = join(dir, "app.ts");
  writeFileSync(file, "const x = 1;\nconst x = 2;\n");

  const registry = createRegistry();
  const run = (args: Record<string, unknown>) => registry.execute("edit_file", args, { cwd: dir });

  // Appears twice → rejected.
  const multi = await run({ path: "app.ts", oldString: "const x =", newString: "const y =" });
  assert.ok(multi.isError);
  assert.ok(multi.content.includes("2 times"), multi.content);

  // Not present → rejected.
  const missing = await run({ path: "app.ts", oldString: "nope", newString: "yep" });
  assert.ok(missing.isError);
  assert.ok(missing.content.includes("not found"), missing.content);

  // Unique → applied.
  const ok = await run({ path: "app.ts", oldString: "const x = 2;", newString: "const z = 3;" });
  assert.equal(ok.isError, false);
  assert.match(readFileSync(file, "utf8"), /const z = 3;/);
  rmSync(dir, { recursive: true, force: true });
});

test("run_command executes and danger patterns are blocked", async () => {
  const dir = tempProject();
  const registry = createRegistry();
  const ok = await registry.execute("run_command", { command: "echo codeshark-test" }, { cwd: dir });
  assert.equal(ok.isError, false);
  assert.ok(ok.content.includes("codeshark-test"), ok.content);

  const blocked = await registry.execute("run_command", { command: "rm -rf /tmp/whatever" }, { cwd: dir });
  assert.ok(blocked.isError);
  assert.ok(blocked.content.includes("Blocked"), blocked.content);
  rmSync(dir, { recursive: true, force: true });
});

test("read_file windows and lists line numbers", async () => {
  const dir = tempProject();
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
  const registry = createRegistry();
  const full = await registry.execute("read_file", { path: "a.txt" }, { cwd: dir });
  assert.ok(full.content.includes("3 | three"));
  const window = await registry.execute("read_file", { path: "a.txt", offset: 2, limit: 2 }, { cwd: dir });
  assert.ok(window.content.includes("2 | two"));
  assert.ok(window.content.includes("3 | three"));
  assert.ok(!window.content.includes("1 | one"));
  rmSync(dir, { recursive: true, force: true });
});

test("glob finds nested files", async () => {
  const dir = tempProject();
  mkdirSync(join(dir, "src", "deep"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "");
  writeFileSync(join(dir, "src", "deep", "b.ts"), "");
  writeFileSync(join(dir, "src", "c.js"), "");
  const registry = createRegistry();
  const res = await registry.execute("glob", { pattern: "src/**/*.ts" }, { cwd: dir });
  assert.ok(!res.isError);
  assert.ok(res.content.includes("src/a.ts"));
  assert.ok(res.content.includes("src/deep/b.ts"));
  assert.ok(!res.content.includes("c.js"));
  rmSync(dir, { recursive: true, force: true });
});