/**
 * CodeShark community gateway.
 *
 * Gives CodeShark its "works out of the box" default: end users talk to this
 * gateway with NO API key. The free-tier keys live here as Worker secrets and
 * are never exposed, never logged, and never returned to clients.
 *
 * Failover chain (tries in order until one answers):
 *   1. UnoRouter    — all catalog models on `:free` lanes (primary)
 *   2. OpenRouter   — best-effort `:free` aliases (or `openrouter/free`)
 *
 * (NVIDIA NIM was removed as a lane: NVIDIA's free NIM terms do not permit
 * commercial use, and CodeShark is an MIT-licensed product.)
 *
 * When a provider rate-limits (429), the gateway waits and retries once, then
 * hands off to the next provider — users experience a queue, not errors.
 * Per-IP bursts also wait in line before being admitted.
 *
 * Secrets (set with `npx wrangler secret put`):
 *   UNOROUTER_API_KEY   — free UnoRouter key (primary; no credit card needed).
 *   OPENROUTER_API_KEY  — free OpenRouter key (fallback).
 *   GATEWAY_SHARED_SECRET — optional; if set, clients must send it as
 *                         `Authorization: Bearer <secret>`.
 */

export interface Env {
  UNOROUTER_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GATEWAY_SHARED_SECRET?: string;
}

const UNOROUTER_URL = "https://api.unorouter.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Best-effort free aliases for the CodeShark catalog on fallback providers.
 * Providers occasionally rename slugs — edit these to match their current
 * free catalogs. A missing alias just skips that provider for that model.
 * OpenRouter's `openrouter/free` meta-slug routes to any available free model.
 */
const OPENROUTER_ALIASES: Record<string, string> = {
  "glm-5.3-flash-think-search:free": "openrouter/free",
  "gemini-3.6-flash:free": "google/gemini-3.6-flash:free",
  "nemotron-3-ultra-550b-a55b:free": "openrouter/free",
  "minimax-m2.7:free": "minimax/minimax-m2.7:free",
};

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-requested-with",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });

function isFreeModel(model: string): boolean {
  return model === "openrouter/free" || model.endsWith(":free");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── Simple per-IP rate limiting (in-memory, per isolate) ────────────────
const WINDOW_MS = 60_000;
const MAX_PER_MINUTE = 20;
const MAX_PER_DAY = 200;
const hits = new Map<string, { minute: number; countMinute: number; day: string; countDay: number }>();

function rateLimit(ip: string): { ok: boolean; message?: string } {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const rec = hits.get(ip) ?? { minute: now, countMinute: 0, day: today, countDay: 0 };
  if (now - rec.minute > WINDOW_MS) {
    rec.minute = now;
    rec.countMinute = 0;
  }
  if (rec.day !== today) {
    rec.day = today;
    rec.countDay = 0;
  }
  rec.countMinute++;
  rec.countDay++;
  hits.set(ip, rec);
  // Opportunistic cleanup so the map doesn't grow forever.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (now - v.minute > WINDOW_MS) hits.delete(k);
    }
  }
  if (rec.countMinute > MAX_PER_MINUTE) return { ok: false, message: "Too many requests this minute (free-tier sharing). Wait a moment and retry." };
  if (rec.countDay > MAX_PER_DAY) return { ok: false, message: "Daily free-tier limit reached on the community gateway. Add your own free key with `codeshark setup`." };
  return { ok: true };
}

// ── Queue: per-IP in-flight slots, so bursts wait instead of failing ────
const MAX_INFLIGHT_PER_IP = 2;
const QUEUE_POLL_MS = 120;
const MAX_QUEUE_WAIT_MS = 8_000;
const inflight = new Map<string, number>();

async function waitForSlot(ip: string): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const n = inflight.get(ip) ?? 0;
    if (n < MAX_INFLIGHT_PER_IP) {
      inflight.set(ip, n + 1);
      return true;
    }
    if (Date.now() - start >= MAX_QUEUE_WAIT_MS) return false;
    await sleep(QUEUE_POLL_MS);
  }
}

function releaseSlot(ip: string): void {
  const n = inflight.get(ip) ?? 1;
  if (n <= 1) inflight.delete(ip);
  else inflight.set(ip, n - 1);
}

// ── Provider chain ──────────────────────────────────────────────────────
interface Upstream {
  name: string;
  url: string;
  key: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

function buildChain(model: string, env: Env): Upstream[] {
  const chain: Upstream[] = [];
  if (env.UNOROUTER_API_KEY) {
    chain.push({ name: "unorouter", url: UNOROUTER_URL, key: env.UNOROUTER_API_KEY, model });
  }
  if (env.OPENROUTER_API_KEY) {
    chain.push({
      name: "openrouter",
      url: OPENROUTER_URL,
      key: env.OPENROUTER_API_KEY,
      model: OPENROUTER_ALIASES[model] ?? "openrouter/free",
      extraHeaders: { "HTTP-Referer": "https://github.com/codeshark/codeshark", "X-Title": "CodeShark Gateway" },
    });
  }
  return chain;
}

const MAX_UPSTREAM_RETRIES = 1; // attempts per provider (2 total), waiting between them
const RETRY_AFTER_MAX_MS = 3_000;

/** POST to one provider, waiting through 429 rate limits before giving up. */
async function tryUpstream(up: Upstream, payload: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${up.key}`,
    ...up.extraHeaders,
  };
  let last: Response | undefined;
  for (let attempt = 0; attempt <= MAX_UPSTREAM_RETRIES; attempt++) {
    last = await fetch(up.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (last.status !== 429 || attempt === MAX_UPSTREAM_RETRIES) return last;
    // Rate-limited: wait it out (respect Retry-After, capped) — the queue.
    const retryAfter = Number(last.headers.get("retry-after") ?? "0") || 1;
    await sleep(Math.min(retryAfter * 1000, RETRY_AFTER_MAX_MS));
  }
  return last!;
}

function clientIP(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "codeshark-gateway",
        free: true,
        models: "CodeShark catalog models (:free lanes)",
        providers: ["unorouter", "openrouter"].filter((p) => {
          const key = env[`${p.toUpperCase()}_API_KEY` as "UNOROUTER_API_KEY"];
          return Boolean(key);
        }),
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      return handleChat(request, env);
    }

    return json({ error: "not found" }, 404);
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  const ip = clientIP(request);
  const limit = rateLimit(ip);
  if (!limit.ok) return json({ error: { message: limit.message, code: 429 } }, 429);

  if (env.GATEWAY_SHARED_SECRET) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.GATEWAY_SHARED_SECRET}`) {
      return json({ error: { message: "This gateway requires a shared key (see README).", code: 401 } }, 401);
    }
  }

  let body: { model?: string; messages?: unknown; tools?: unknown; stream?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: { message: "Invalid JSON body.", code: 400 } }, 400);
  }

  if (!body.messages) return json({ error: { message: "messages is required.", code: 400 } }, 400);

  const model = typeof body.model === "string" ? body.model : "glm-5.3-flash-think-search:free";
  if (!isFreeModel(model)) {
    return json(
      {
        error: {
          message: `Model "${model}" is not allowed. This gateway only serves free models (":free" or "openrouter/free"). CodeShark never spends money.`,
          code: 400,
        },
      },
      400,
    );
  }

  const chain = buildChain(model, env);
  if (!chain.length) {
    return json(
      {
        error: {
          message:
            "Gateway is not configured yet (no UNOROUTER_API_KEY or OPENROUTER_API_KEY secret). See worker/README.md.",
          code: 503,
        },
      },
      503,
    );
  }

  // Queue: wait for a slot instead of rejecting a burst outright.
  const gotSlot = await waitForSlot(ip);
  if (!gotSlot) {
    return json(
      {
        error: {
          message:
            "The gateway is busy — you're queued behind other users right now. Wait a few seconds and retry, or add your own key with `codeshark setup`.",
          code: 429,
        },
      },
      429,
    );
  }
  try {
    // Failover: try each provider in order; the first non-error answers.
    let lastResponse: Response | null = null;
    for (const up of chain) {
      const payload = {
        model: up.model,
        messages: body.messages,
        tools: body.tools,
        stream: body.stream ?? true,
        temperature: 0.3,
      };
      const res = await tryUpstream(up, payload);
      if (res.status < 400) {
        // Pass the (possibly streaming) body straight through with CORS headers.
        return new Response(res.body, {
          status: res.status,
          headers: {
            "content-type": res.headers.get("content-type") ?? "application/json",
            ...CORS_HEADERS,
          },
        });
      }
      lastResponse = res;
    }
    // Every provider failed: surface the last provider's error.
    if (lastResponse) {
      return new Response(lastResponse.body, {
        status: lastResponse.status,
        headers: {
          "content-type": lastResponse.headers.get("content-type") ?? "application/json",
          ...CORS_HEADERS,
        },
      });
    }
    return json({ error: { message: "No provider available.", code: 503 } }, 503);
  } finally {
    releaseSlot(ip);
  }
}