import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBanner } from "../dist/banner.js";
import { stripAnsi } from "../dist/ansi.js";

test("plain banner contains title, model line, and cwd", () => {
  const text = renderBanner({ plain: true, cwd: "/tmp/project" });
  assert.ok(text.includes("█"));
  assert.ok(text.includes("/tmp/project"));
  assert.ok(!text.includes("\u001b["), "plain banner must not contain ANSI escapes");
});

test("plain banner contains the text wordmark without sprite blocks", () => {
  const text = renderBanner({ plain: true });
  assert.ok(text.split("\n").length >= 10, "wordmark should be large and multi-row");
  assert.ok(text.includes("██"), "wordmark should render wide block letters");
});

test("colored banner strips cleanly to a large wordmark", () => {
  const text = renderBanner({ cwd: "/x" });
  assert.ok(text.includes("\u001b["), "default banner should be colored");
  assert.ok(stripAnsi(text).includes("████"));
});

test("colored wordmark uses white Code and a blue gradient for Shark", () => {
  const text = renderBanner({ cwd: "/x" });
  assert.match(text, /\u001b\[38;2;248;250;252m██/);
  assert.match(text, /\u001b\[38;2;11;42;91m██/);
  assert.match(text, /\u001b\[38;2;155;220;255m██/);
});

test("model line reflects config", () => {
  const text = renderBanner({ plain: true, modelLine: "GLM 5.3 Flash Thinking · 1M context", cwd: "/tmp" });
  assert.ok(text.includes("GLM 5.3 Flash Thinking · 1M context"));
});