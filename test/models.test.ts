import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, RETIRED_MODELS, DEFAULT_MODEL_ID, findModel, isRetiredModel, toApiSlug } from "../dist/models.js";
import { activeApiModel, activeModelId, activeProvider, modelLabel } from "../dist/config.js";

test("catalog contains exactly the four current models", () => {
  const ids = MODELS.map((m) => m.id);
  assert.deepEqual(ids, [
    "unorouter/glm-5.3-flash-think-search",
    "unorouter/gemini-3.6-flash",
    "unorouter/nemotron-3-ultra-550b-a55b",
    "unorouter/minimax-m2.7",
  ]);
  assert.equal(DEFAULT_MODEL_ID, "unorouter/glm-5.3-flash-think-search");
});

test("removed models are retired so saved configs self-heal", () => {
  for (const slug of ["gpt-5.6-sol:free", "deepseek-v4-flash:free", "minimax-m3:free", "sarvam-30b:free", "gpt-oss-120b:free"]) {
    assert.ok(isRetiredModel(slug), `${slug} must be retired`);
    assert.equal(findModel(slug)?.available, false);
  }
  assert.equal(RETIRED_MODELS.length >= 8, true);
  // Every retired entry is also recognized by its catalog id.
  assert.ok(isRetiredModel("unorouter/sarvam-30b"));
});

test("catalog models use their configured providers", () => {
  for (const m of MODELS) {
    if (m.provider === "unorouter") assert.ok(m.model.endsWith(":free"), `${m.id} must use a :free slug`);
  }
});

test("catalog ids map to the correct raw API slugs", () => {
  assert.equal(toApiSlug("unorouter/glm-5.3-flash-think-search"), "glm-5.3-flash-think-search:free");
  assert.equal(toApiSlug("unorouter/gemini-3.6-flash"), "gemini-3.6-flash:free");
  assert.equal(toApiSlug("unorouter/nemotron-3-ultra-550b-a55b"), "nemotron-3-ultra-550b-a55b:free");
  assert.equal(toApiSlug("unorouter/minimax-m2.7"), "minimax-m2.7:free");
  // Raw slugs pass through untouched.
  assert.equal(toApiSlug("some/custom-model"), "some/custom-model");
});

test("findModel accepts ids and raw slugs", () => {
  assert.equal(findModel("unorouter/minimax-m2.7")?.provider, "unorouter");
  assert.equal(findModel("glm-5.3-flash-think-search:free")?.provider, "unorouter");
  assert.equal(findModel("nope"), undefined);
});

test("activeProvider follows the selected model", () => {
  assert.equal(activeProvider({ model: "unorouter/glm-5.3-flash-think-search" }), "unorouter");
  assert.equal(activeProvider({ model: "unorouter/minimax-m2.7" }), "unorouter");
  assert.equal(activeModelId({ model: "unorouter/sarvam-30b" }), DEFAULT_MODEL_ID);
  assert.equal(activeModelId({ model: "sarvam-30b:free" }), DEFAULT_MODEL_ID);
  assert.equal(activeProvider({ provider: "gemini", model: "gemini-2.5-pro" }), "gemini");
});

test("activeApiModel resolves the API slug for the selection", () => {
  assert.equal(activeApiModel({ model: "unorouter/minimax-m2.7" }), "minimax-m2.7:free");
  assert.equal(activeApiModel({}), "glm-5.3-flash-think-search:free");
  assert.equal(activeModelId({}), "unorouter/glm-5.3-flash-think-search");
});

test("modelLabel returns the plain model label with no provider branding", () => {
  assert.equal(modelLabel({ model: "unorouter/minimax-m2.7" }), "MiniMax M2.7");
  // Key presence doesn't change the label — no "via UnoRouter" style branding.
  assert.equal(modelLabel({ model: "unorouter/minimax-m2.7", unorouterApiKey: "ur-test" }), "MiniMax M2.7");
  assert.match(modelLabel({}), /GLM 5\.3/);
  const label = modelLabel({});
  assert.ok(!label.includes("via"), "no 'via X' provider branding");
  assert.ok(!label.includes("UnoRouter"));
});
