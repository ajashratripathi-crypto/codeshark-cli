import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFolderArg, requireProjectFolder, resolveProjectPath, ProjectFolderError } from "../dist/project.js";

test("folder arguments are extracted without changing the prompt", () => {
  const parsed = extractFolderArg(["--folder", "./demo", "fix", "the", "tests"]);
  assert.deepEqual(parsed.args, ["fix", "the", "tests"]);
  assert.equal(parsed.folder?.endsWith("demo"), true);

  const equals = extractFolderArg(["--cwd=./demo", "hello"]);
  assert.deepEqual(equals.args, ["hello"]);
});

test("project folder validation rejects files and missing paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeshark-project-test-"));
  const file = join(dir, "file.txt");
  writeFileSync(file, "test");
  assert.equal(requireProjectFolder(dir), dir);
  assert.throws(() => requireProjectFolder(file), ProjectFolderError);
  assert.throws(() => requireProjectFolder(join(dir, "missing")), ProjectFolderError);
  rmSync(dir, { recursive: true, force: true });
});

test("workspace paths cannot escape the selected project folder", () => {
  const root = mkdtempSync(join(tmpdir(), "codeshark-workspace-test-"));
  mkdirSync(join(root, "src"));
  assert.equal(resolveProjectPath("src/app.ts", root), join(root, "src", "app.ts"));
  assert.equal(resolveProjectPath(root, root), root);
  assert.throws(() => resolveProjectPath("../outside.txt", root), ProjectFolderError);
  assert.throws(() => resolveProjectPath(join(root, "..", "outside.txt"), root), ProjectFolderError);
  rmSync(root, { recursive: true, force: true });
});
