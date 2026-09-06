import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBanner } from "../dist/banner.js";
import { stripAnsi } from "../dist/ansi.js";

test("plain banner contains title, model line, and cwd", () => {
  const text = renderBanner({ columns: 120, plain: true, cwd: "/tmp/project" });
  assert.ok(text.includes("█"));
  assert.ok(text.includes("/tmp/project"));
  assert.ok(!text.includes("\u001b["), "plain banner must not contain ANSI escapes");
});

test("plain banner contains the text wordmark without sprite blocks", () => {
  const text = renderBanner({ columns: 120, plain: true });
  assert.ok(text.split("\n").length >= 10, "wordmark should be large and multi-row");
  assert.ok(text.includes("██"), "wordmark should render wide block letters");
});

test("colored banner strips cleanly to a large wordmark", () => {
  const text = renderBanner({ columns: 120, cwd: "/x" });
  assert.ok(text.includes("\u001b["), "default banner should be colored");
  assert.ok(stripAnsi(text).includes("████"));
});

test("colored wordmark uses white Code and a blue gradient for Shark", () => {
  const text = renderBanner({ columns: 120, cwd: "/x" });
  assert.match(text, /\u001b\[38;2;248;250;252m██/);
  assert.match(text, /\u001b\[38;2;11;42;91m██/);
  assert.match(text, /\u001b\[38;2;155;220;255m██/);
});

test("model line reflects config", () => {
  const text = renderBanner({ columns: 120, plain: true, modelLine: "GLM 5.3 Flash Thinking · 1M context", cwd: "/tmp" });
  assert.ok(text.includes("GLM 5.3 Flash Thinking · 1M context"));
});
for (const columns of [40, 55, 56, 80, 100, 101, 120]) {
  test('banner fits ' + columns + ' columns', () => {
    const text = renderBanner({ plain: true, columns, modelLine: 'test', cwd: '/tmp' });
    const title = text.split('\n\n')[0];
    assert.ok(title.split('\n').every((line) => line.length < columns));
    if (columns < 56) assert.equal(title.trim(), 'CODESHARK');
    else assert.equal(title.split('\n').length, 7);
  });
}
