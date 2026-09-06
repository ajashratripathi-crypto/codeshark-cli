import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyProbeFailure } from "../dist/modelAvailability.js";

test("5xx and 429 lane errors are busy, not unavailable", () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const { status: availability } = classifyProbeFailure(status);
    assert.equal(availability, "busy", `HTTP ${status} should classify as busy`);
  }
});

test("timeouts and network errors are busy", () => {
  const abort = new Error("The operation was aborted");
  abort.name = "AbortError";
  assert.equal(classifyProbeFailure(abort).status, "busy");
  assert.equal(classifyProbeFailure(new Error("ECONNRESET")).status, "busy");
});

test("client errors are genuinely unavailable", () => {
  for (const status of [400, 401, 403, 404]) {
    const result = classifyProbeFailure(status);
    assert.equal(result.status, "unavailable", `HTTP ${status} should classify as unavailable`);
    assert.match(result.reason, /HTTP \d+/);
  }
});

test("every classification carries a human-readable reason", () => {
  assert.equal(classifyProbeFailure(503).reason.length > 0, true);
  assert.equal(classifyProbeFailure(new Error("boom")).reason, "boom");
});
