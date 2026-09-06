import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "../dist/tools/index.js";
import { runAgent } from "../dist/agent.js";
import { resolveProjectPath } from "../dist/project.js";
import { jsSearch } from "../dist/tools/search.js";
import { createOpenAICompatClient } from "../dist/provider/openaiCompat.js";
import type { ChatClient, ChatMessage } from "../dist/provider/types.js";

function project(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "codeshark-reliability-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function response(events: unknown[]): Response {
  const data = events.map(event => "data: " + (typeof event === "string" ? event : JSON.stringify(event)) + "\n\n").join("");
  return new Response(data);
}
const textEvent = { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] };
const toolEvent = (args: string) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_file", arguments: args } }] }, finish_reason: null }] });
function clientWith(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return createOpenAICompatClient({ provider: "test", baseUrl: "https://example.test/v1", model: "test", fetchImpl, ...extra });
}

test("tool validation rejects missing content instead of overwriting a file", async t => {
  const cwd = project(t);
  writeFileSync(join(cwd, "keep.txt"), "keep me");
  const registry = createRegistry();
  const result = await registry.execute("write_file", { path: "keep.txt" }, { cwd });
  assert.equal(result.isError, true);
  assert.equal(readFileSync(join(cwd, "keep.txt"), "utf8"), "keep me");
  for (const offset of [0, -1, 1.5, "2", null]) {
    assert.equal((await registry.execute("read_file", { path: "keep.txt", offset }, { cwd })).isError, true);
  }
});

test("plan mode enforces read-only execution even if a provider requests an edit", async t => {
  const cwd = project(t);
  const registry = createRegistry();
  let calls = 0;
  const client: ChatClient = { provider: "test", model: "test", isFree: true, async chat(messages, tools) {
    assert.ok(!tools.some(tool => tool.name === "write_file" || tool.name === "run_command"));
    assert.ok(tools.some(tool => tool.name === "read_file"));
    if (calls++ === 0) return { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "write_file", args: { path: "no.txt", content: "no" } }] };
    assert.match(messages.find(message => message.role === "tool")!.content, /read-only/);
    return { role: "assistant", content: "Here is the plan." };
  }};
  await runAgent("plan", { clients: [client], registry, cwd, readOnly: true });
  assert.equal(existsSync(join(cwd, "no.txt")), false);
});

test("finish completes every tool call in history and skips subsequent edits", async t => {
  const cwd = project(t);
  const client: ChatClient = { provider: "test", model: "test", isFree: true, async chat() {
    return { role: "assistant", content: "", toolCalls: [
      { id: "finish", name: "finish", args: { summary: "Done" } },
      { id: "edit", name: "write_file", args: { path: "no.txt", content: "no" } },
    ] };
  }};
  const result = await runAgent("finish", { clients: [client], registry: createRegistry(), cwd });
  assert.equal(result.text, "Done");
  assert.deepEqual(result.history.filter(message => message.role === "tool").map(message => message.toolCallId), ["finish", "edit"]);
  assert.deepEqual(result.history.at(-1), { role: "assistant", content: "Done" });
  assert.equal(existsSync(join(cwd, "no.txt")), false);
});

test("agent cancellation does not invoke fallback providers", async t => {
  const cwd = project(t);
  const controller = new AbortController();
  let fallbackCalls = 0;
  const primary: ChatClient = { provider: "test", model: "test", isFree: true, async chat() {
    controller.abort(new Error("cancelled")); throw new Error("network aborted");
  }};
  const fallback: ChatClient = { ...primary, async chat() { fallbackCalls++; return { role: "assistant", content: "wrong" }; } };
  await assert.rejects(runAgent("go", { clients: [primary, fallback], registry: createRegistry(), cwd, signal: controller.signal }), /cancelled/);
  assert.equal(fallbackCalls, 0);
});

test("partial streamed replies are not mixed with fallback output", async t => {
  const cwd = project(t);
  let fallbackCalls = 0;
  const primary: ChatClient = { provider: "test", model: "test", isFree: true, async chat(_messages, _tools, events) {
    events?.onText?.("partial"); throw new Error("stream failed");
  }};
  const fallback: ChatClient = { ...primary, async chat() { fallbackCalls++; return { role: "assistant", content: "wrong" }; } };
  await assert.rejects(runAgent("go", { clients: [primary, fallback], registry: createRegistry(), cwd }, { onText() {} }), /stream failed/);
  assert.equal(fallbackCalls, 0);
});

test("glob scans past 200 unrelated files and handles brace directory patterns", async t => {
  const cwd = project(t);
  for (let i = 0; i < 220; i++) writeFileSync(join(cwd, "a" + i + ".txt"), "");
  mkdirSync(join(cwd, "src")); mkdirSync(join(cwd, "test"));
  writeFileSync(join(cwd, "src", "target.ts"), "");
  writeFileSync(join(cwd, "test", "target.ts"), "");
  const registry = createRegistry();
  for (const pattern of ["**/*.ts", "{src,test}/*.ts", "s?c/*.ts"]) {
    const result = await registry.execute("glob", { pattern }, { cwd });
    assert.equal(result.isError, false);
    assert.match(result.content, /src\/target.ts/);
  }
});

test("glob reports when matching results are capped", async t => {
  const cwd = project(t);
  for (let i = 0; i < 201; i++) writeFileSync(join(cwd, i + ".txt"), "");
  const result = await createRegistry().execute("glob", { pattern: "*.txt" }, { cwd });
  assert.match(result.content, /200 matches/);
  assert.match(result.content, /More matches exist/);
});

test("project paths reject links leading outside, including new descendants", t => {
  const root = project(t);
  mkdirSync(join(root, "project")); mkdirSync(join(root, "outside"));
  symlinkSync(join(root, "outside"), join(root, "project", "link"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => resolveProjectPath("link/new/file.txt", join(root, "project")), /escapes/);
  assert.equal(resolveProjectPath("new/file.txt", join(root, "project")), join(root, "project", "new", "file.txt"));
});

test("overlapping edit matches are rejected", async t => {
  const cwd = project(t); writeFileSync(join(cwd, "a.txt"), "aaa");
  const result = await createRegistry().execute("edit_file", { path: "a.txt", oldString: "aa", newString: "x" }, { cwd });
  assert.equal(result.isError, true);
  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "aaa");
});

test("large reads default to a useful page and include continuation", async t => {
  const cwd = project(t); writeFileSync(join(cwd, "a.txt"), Array.from({ length: 500 }, (_, i) => "line " + (i + 1)).join("\n"));
  const result = await createRegistry().execute("read_file", { path: "a.txt" }, { cwd });
  assert.match(result.content, /400 \| line 400/);
  assert.doesNotMatch(result.content, /401 \|/);
  assert.match(result.content, /offset=401/);
});

test("fallback search honors whole-word matches and a global result cap", t => {
  const cwd = project(t); writeFileSync(join(cwd, "a.txt"), "scatter\ncat\ncatalog\n");
  const result = jsSearch(cwd, "cat", "-w");
  assert.match(result, /a.txt:2:cat/); assert.doesNotMatch(result, /scatter|catalog/);
  writeFileSync(join(cwd, "many.txt"), "match\n".repeat(500));
  assert.equal(jsSearch(cwd, "match", "").split("\n").length, 200);
});

test("shell reports a nonzero exit as a failed tool result", async t => {
  const result = await createRegistry().execute("run_command", { command: "exit 7" }, { cwd: project(t) });
  assert.equal(result.isError, true); assert.match(result.content, /exit code: 7/);
});

test("provider preserves plain-text HTTP errors", async () => {
  const client = clientWith(async () => new Response("Upstream rejected this request", { status: 400 }));
  await assert.rejects(client.chat([], []), /Upstream rejected this request/);
});

test("provider accepts complete tool arguments ending with DONE", async () => {
  const client = clientWith(async () => response([toolEvent('{"path":"a.txt","content":"ok"}'), "[DONE]"]));
  const message = await client.chat([], []);
  assert.equal(message.role, "assistant");
  if (message.role === "assistant") assert.deepEqual(message.toolCalls?.[0]?.args, { path: "a.txt", content: "ok" });
});

test("provider rejects malformed arguments instead of executing an empty object", async () => {
  for (const args of ['{"path":', '[]', 'null']) {
    const client = clientWith(async () => response([toolEvent(args), "[DONE]"]));
    await assert.rejects(client.chat([], []), /invalid tool arguments/);
  }
});

test("provider rejects streams that end before completion", async () => {
  const client = clientWith(async () => response([{ choices: [{ delta: { content: "partial" }, finish_reason: null }] }]));
  await assert.rejects(client.chat([], []), /before completion/);
});

test("provider releases a stream when DONE arrives without socket closure", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); }, cancel() { cancelled = true; } });
  const client = clientWith(async () => new Response(stream));
  await client.chat([], []); assert.equal(cancelled, true);
});

test("provider cancellation interrupts rate-limit backoff", async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = clientWith(async () => { calls++; return new Response("rate limited", { status: 429 }); }, { rateLimitRetryDelays: [10_000] });
  const request = client.chat([], [], undefined, controller.signal);
  setTimeout(() => controller.abort(new Error("cancel requested")), 20);
  await assert.rejects(request, /cancel requested/);
  assert.equal(calls, 1);
});

test("provider timeout aborts stalled requests", async () => {
  const client = clientWith(async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }), { timeoutMs: 20 });
  await assert.rejects(client.chat([], []), /timed out/);
});

test("provider releases rate-limited responses before retrying", async () => {
  let cancelled = false; let calls = 0;
  const client = clientWith(async () => {
    if (calls++ === 0) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 429, headers: { "retry-after": "0" } });
    return response([textEvent]);
  });
  assert.equal((await client.chat([], [])).content, "Hello");
  assert.equal(cancelled, true);
});

test("configuration saves atomically and tolerates invalid values", async t => {
  const { saveConfig, loadConfig } = await import("../dist/config.js");
  const cwd = project(t);
  const previous = process.env.CODESHARK_CONFIG;
  process.env.CODESHARK_CONFIG = join(cwd, "config.json");
  try {
    for (const value of ['null', '[]', '{"model":42,"maxIterations":-1,"termsAccepted":"yes"}']) {
      writeFileSync(process.env.CODESHARK_CONFIG, value);
      assert.deepEqual(loadConfig(), {});
    }
    saveConfig({ model: "test", maxIterations: 3 });
    saveConfig({ model: "updated", maxIterations: 4 });
    assert.deepEqual(loadConfig(), { model: "updated", maxIterations: 4 });
    const { readdirSync } = await import("node:fs");
    assert.deepEqual(readdirSync(cwd), ["config.json"]);
  } finally {
    if (previous === undefined) delete process.env.CODESHARK_CONFIG;
    else process.env.CODESHARK_CONFIG = previous;
  }
});

test("shell cancellation stops the running command", { timeout: 5000 }, async t => {
  const controller = new AbortController();
  const result = createRegistry().execute("run_command", { command: 'node -e "setTimeout(function(){},10000)"' }, { cwd: project(t), signal: controller.signal });
  const timer = setTimeout(() => controller.abort(new Error("cancelled by user")), 150);
  t.after(() => clearTimeout(timer));
  const finished = await result;
  assert.equal(finished.isError, true);
  assert.match(finished.content, /cancelled by user/);
});

test("shell output remains bounded even when the command fails", async t => {
  const result = await createRegistry().execute("run_command", { command: 'node -e "console.log(\'x\'.repeat(100000));process.exit(1)"' }, { cwd: project(t) });
  assert.equal(result.isError, true);
  assert.ok(result.content.length < 31_000);
  assert.match(result.content, /truncated/i);
});
