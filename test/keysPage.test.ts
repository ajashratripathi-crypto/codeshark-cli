import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeKeysPage, launchKeysPage } from "../dist/keysPage.js";
import { loadConfig, saveConfig } from "../dist/config.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "codeshark-vault-test-"));
}

async function form(url: string, path: string, values: Record<string, string>, cookie?: string): Promise<Response> {
  return fetch(`${url}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(values),
  });
}

test("key vault requires a password and never embeds saved secrets in HTML", async () => {
  const dir = tempDir();
  const config = join(dir, "config.json");
  const auth = join(dir, "auth.json");
  const previous = {
    config: process.env.CODESHARK_CONFIG,
    auth: process.env.CODESHARK_AUTH,
    browser: process.env.CODESHARK_NO_BROWSER,
  };
  process.env.CODESHARK_CONFIG = config;
  process.env.CODESHARK_AUTH = auth;
  process.env.CODESHARK_NO_BROWSER = "1";

  try {
    saveConfig({ openrouterApiKey: "sk-or-v1-super-secret-value" });
    const url = await launchKeysPage(0);

    const first = await fetch(url);
    const firstHtml = await first.text();
    assert.equal(first.status, 200);
    assert.match(firstHtml, /Create password/);
    assert.doesNotMatch(firstHtml, /super-secret-value/);

    const created = await form(url, "/setup", { password: "correct horse battery", confirm: "correct horse battery" });
    assert.equal(created.status, 303);
    assert.ok(readFileSync(auth, "utf8").includes("passwordHash"));

    const loginPage = await fetch(url);
    const loginHtml = await loginPage.text();
    assert.match(loginHtml, /Unlock key vault/);
    assert.doesNotMatch(loginHtml, /super-secret-value/);

    const wrong = await form(url, "/login", { password: "wrong password" });
    assert.equal(wrong.status, 401);
    assert.doesNotMatch(await wrong.text(), /super-secret-value/);

    const login = await form(url, "/login", { password: "correct horse battery" });
    assert.equal(login.status, 303);
    const setCookie = login.headers.get("set-cookie");
    assert.ok(setCookie);
    const cookie = setCookie.split(";")[0]!;

    const unlocked = await fetch(url, { headers: { cookie } });
    const unlockedHtml = await unlocked.text();
    assert.equal(unlocked.status, 200);
    assert.match(unlockedHtml, /API keys/);
    assert.match(unlockedHtml, /sk-or-v1-.*not set|OpenRouter:/);
    assert.doesNotMatch(unlockedHtml, /super-secret-value/);

    const csrf = /name="csrf" value="([^"]+)"/.exec(unlockedHtml)?.[1];
    assert.ok(csrf);
    const saved = await form(url, "/save", { csrf, geminiApiKey: "AIza-new-key" }, cookie);
    assert.equal(saved.status, 303);
    assert.equal(loadConfig().geminiApiKey, "AIza-new-key");
    assert.equal(loadConfig().openrouterApiKey, "sk-or-v1-super-secret-value");
  } finally {
    closeKeysPage();
    if (previous.config === undefined) delete process.env.CODESHARK_CONFIG;
    else process.env.CODESHARK_CONFIG = previous.config;
    if (previous.auth === undefined) delete process.env.CODESHARK_AUTH;
    else process.env.CODESHARK_AUTH = previous.auth;
    if (previous.browser === undefined) delete process.env.CODESHARK_NO_BROWSER;
    else process.env.CODESHARK_NO_BROWSER = previous.browser;
    rmSync(dir, { recursive: true, force: true });
  }
});
