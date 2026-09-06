import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { exec } from "node:child_process";
import { configPath, loadConfig, saveConfig, type CodeSharkConfig } from "./config.js";

const DEFAULT_PORT = 4317;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 32_000;

interface AuthFile {
  salt: string;
  passwordHash: string;
}

interface Session {
  token: string;
  csrf: string;
  expiresAt: number;
}

let pageServer: Server | undefined;
let pageUrl: string | undefined;
let authFilePath: string | undefined;
const sessions = new Map<string, Session>();

function authPath(): string {
  return process.env.CODESHARK_AUTH ?? join(dirname(configPath()), ".codeshark-auth.json");
}

function readAuth(): AuthFile | undefined {
  const p = authPath();
  authFilePath = p;
  try {
    if (!existsSync(p)) return undefined;
    return JSON.parse(readFileSync(p, "utf8")) as AuthFile;
  } catch {
    return undefined;
  }
}

function saveAuth(password: string): void {
  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, salt, 32).toString("hex");
  const p = authPath();
  authFilePath = p;
  writeFileSync(p, JSON.stringify({ salt, passwordHash }, null, 2) + "\n", "utf8");
  try {
    chmodSync(p, 0o600);
  } catch {
    // Windows permissions are controlled by the user account.
  }
}

function validPassword(password: string): boolean {
  const auth = readAuth();
  if (!auth) return false;
  try {
    const actual = scryptSync(password, auth.salt, 32);
    const expected = Buffer.from(auth.passwordHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function mask(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 5)}${"•".repeat(Math.min(16, value.length - 8))}${value.slice(-3)}`;
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const cookies = req.headers.cookie?.split(";").map((x) => x.trim()) ?? [];
  const found = cookies.find((x) => x.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : undefined;
}

function currentSession(req: IncomingMessage): Session | undefined {
  const token = cookieValue(req, "codeshark_session");
  const session = token ? sessions.get(token) : undefined;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return undefined;
  }
  return session;
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body);
}

function redirect(res: ServerResponse, location: string, cookie?: string): void {
  res.writeHead(303, {
    location,
    "cache-control": "no-store",
    ...(cookie ? { "set-cookie": cookie } : {}),
  });
  res.end();
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(title)} · CodeShark</title>
<style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#101318;color:#e7edf3}
body{max-width:760px;margin:0 auto;padding:42px 22px}h1{font-size:25px;margin:0 0 8px;color:#8fc5ed}h2{font-size:16px;margin-top:30px;color:#d96b43}p,.hint{color:#98a6b3;line-height:1.55}.card{background:#191f27;border:1px solid #2e3a45;border-radius:12px;padding:20px;margin:18px 0}label{display:block;color:#c6d3de;margin:15px 0 7px}input{box-sizing:border-box;width:100%;padding:12px;border-radius:7px;border:1px solid #40505d;background:#0d1117;color:#fff;font:inherit}button{margin-top:18px;padding:11px 16px;border:0;border-radius:7px;background:#4b9bd1;color:#07111a;font:inherit;font-weight:700;cursor:pointer}button.danger{background:#7d3941;color:#fff}.key{font-size:13px;word-break:break-all;color:#c6e3f8}.warning{border-left:3px solid #d96b43;padding-left:12px}.small{font-size:12px;color:#778896}a{color:#8fc5ed}
</style></head><body>${body}</body></html>`;
}

function loginPage(message = ""): string {
  const auth = readAuth();
  if (!auth) {
    return page(
      "Create local password",
      `<h1>CodeShark key vault</h1><p>Set a local password before viewing API keys. This password is stored as a one-way hash and never leaves this computer.</p>${message ? `<p class="warning">${htmlEscape(message)}</p>` : ""}<div class="card"><form method="post" action="/setup"><label for="password">Create password</label><input id="password" name="password" type="password" minlength="8" required autofocus><label for="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" minlength="8" required><button>Protect my keys</button></form></div><p class="small">The page only listens on 127.0.0.1. Do not expose this port publicly.</p>`,
    );
  }
  return page(
    "Unlock key vault",
    `<h1>CodeShark key vault</h1><p>Enter your local password to view or edit saved provider keys.</p>${message ? `<p class="warning">${htmlEscape(message)}</p>` : ""}<div class="card"><form method="post" action="/login"><input type="hidden" name="csrf" value="${htmlEscape(randomBytes(16).toString("hex"))}"><label for="password">Password</label><input id="password" name="password" type="password" required autofocus><button>Unlock</button></form></div><p class="small">Forgot the password? Delete ${htmlEscape(authFilePath ?? authPath())} to reset local protection.</p>`,
  );
}

function vaultPage(session: Session): string {
  const cfg = loadConfig();
  const secretInput = (id: "openrouterApiKey" | "unorouterApiKey" | "geminiApiKey", label: string, placeholder: string): string =>
    `<label for="${id}">${label}</label><input id="${id}" name="${id}" type="password" value="" placeholder="${placeholder}" autocomplete="new-password" spellcheck="false"><label class="small"><input type="checkbox" name="clear_${id}" value="1" style="width:auto;margin-right:8px"> Clear this saved key</label>`;
  return page(
    "API keys",
    `<h1>CodeShark key vault</h1><p>Unlocked locally. Values are saved to <code>${htmlEscape(configPath())}</code>. Keep this page on your own computer.</p><div class="card"><form method="post" action="/save"><input type="hidden" name="csrf" value="${htmlEscape(session.csrf)}"><h2>Provider keys</h2>${secretInput("unorouterApiKey", "Primary model API key", "paste a replacement (shown once)…")}${secretInput("openrouterApiKey", "OpenRouter API key", "paste a replacement: sk-or-v1-…")}${secretInput("geminiApiKey", "Gemini API key", "paste a replacement: AIza…")}<p class="small">Saved keys are never placed in this page's HTML. Leave a field blank to keep its current value, or check Clear to remove it.</p><button>Save keys</button></form></div><div class="card"><h2>Current status</h2><p class="key">Primary model API: ${htmlEscape(mask(cfg.unorouterApiKey) || "not set")}</p><p class="key">OpenRouter: ${htmlEscape(mask(cfg.openrouterApiKey) || "not set")}</p><p class="key">Gemini: ${htmlEscape(mask(cfg.geminiApiKey) || "not set")}</p><p class="hint">Your keys are never printed to the terminal by CodeShark.</p><form method="post" action="/logout"><input type="hidden" name="csrf" value="${htmlEscape(session.csrf)}"><button class="danger">Lock vault</button></form></div>`,
  );
}

function parseBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      const params = new URLSearchParams(body);
      resolve(Object.fromEntries(params.entries()));
    });
    req.on("error", reject);
  });
}

function isValidSessionRequest(req: IncomingMessage, body: Record<string, string>, session: Session | undefined): boolean {
  return Boolean(session && body.csrf && body.csrf === session.csrf);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const session = currentSession(req);

  if (method === "GET" && path === "/") {
    send(res, 200, session ? vaultPage(session) : loginPage());
    return;
  }
  if (method === "POST" && path === "/setup") {
    const body = await parseBody(req);
    if (readAuth()) {
      send(res, 403, loginPage("A password already exists. Unlock the vault instead."));
      return;
    }
    if (!body.password || body.password.length < 8 || body.password !== body.confirm) {
      send(res, 400, loginPage("Passwords must match and be at least 8 characters."));
      return;
    }
    saveAuth(body.password);
    return redirect(res, "/");
  }
  if (method === "POST" && path === "/login") {
    const body = await parseBody(req);
    if (!validPassword(body.password ?? "")) {
      send(res, 401, loginPage("Incorrect password."));
      return;
    }
    const token = randomBytes(32).toString("hex");
    const newSession: Session = { token, csrf: randomBytes(24).toString("hex"), expiresAt: Date.now() + SESSION_TTL_MS };
    sessions.set(token, newSession);
    return redirect(res, "/", `codeshark_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`);
  }
  if (method === "POST" && path === "/save") {
    const body = await parseBody(req);
    if (!isValidSessionRequest(req, body, session)) {
      send(res, 403, loginPage("Your session expired. Unlock the vault again."));
      return;
    }
    const cfg = loadConfig();
    for (const field of ["unorouterApiKey", "openrouterApiKey", "geminiApiKey"] as const) {
      const value = body[field]?.trim();
      if (body[`clear_${field}`] === "1") delete cfg[field];
      else if (value) cfg[field] = value;
      // A blank field preserves the existing secret instead of deleting it.
    }
    saveConfig(cfg);
    return redirect(res, "/");
  }
  if (method === "POST" && path === "/logout") {
    const body = await parseBody(req);
    if (isValidSessionRequest(req, body, session)) {
      sessions.delete(session!.token);
      return redirect(res, "/", "codeshark_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    }
    send(res, 403, loginPage("Your session expired."));
    return;
  }
  send(res, 404, page("Not found", "<h1>404</h1><p>That CodeShark vault page does not exist.</p>"));
}

function openBrowser(url: string): void {
  if (process.env.CODESHARK_NO_BROWSER) return;
  const command = process.platform === "win32" ? `cmd /c start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, () => {});
}

export async function launchKeysPage(port = DEFAULT_PORT): Promise<string> {
  if (pageServer && pageUrl) {
    openBrowser(pageUrl);
    return pageUrl;
  }
  pageServer = createServer((req, res) => {
    void handle(req, res).catch(() => send(res, 400, page("Error", "<h1>Bad request</h1>")));
  });
  await new Promise<void>((resolve, reject) => {
    pageServer!.once("error", reject);
    pageServer!.listen(port, "127.0.0.1", () => resolve());
  });
  const address = pageServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  pageUrl = `http://127.0.0.1:${actualPort}`;
  openBrowser(pageUrl);
  return pageUrl;
}

export function closeKeysPage(): void {
  if (pageServer) pageServer.close();
  pageServer = undefined;
  pageUrl = undefined;
  sessions.clear();
}

export function keyVaultPath(): string {
  return authPath();
}
