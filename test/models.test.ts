import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, DEFAULT_MODEL_ID, findModel, toApiSlug } from "../dist/models.js";
import { activeApiModel, activeModelId, activeProvider, modelLabel } from "../dist/config.js";

test("catalog contains the current models", () => {
  const ids = MODELS.map((m) => m.id);
  assert.deepEqual(ids, [
    "unorouter/gpt-5.6-sol",
    "unorouter/deepseek-v4-flash",
    "unorouter/minimax-m3",
    "unorouter/glm-5.3-flash-think-search",
    "unorouter/gemini-3.6-flash",
    "unorouter/sarvam-30b",
    "unorouter/gpt-oss-120b",
    "unorouter/nemotron-3-ultra-550b-a55b",
  ]);
  assert.equal(DEFAULT_MODEL_ID, "unorouter/glm-5.3-flash-think-search");
});

test("catalog models use their configured providers", () => {
  for (const m of MODELS) {
    if (m.provider === "unorouter") assert.ok(m.model.endsWith(":free"), `${m.id} must use a :free slug`);
  }
});

test("catalog ids map to the correct raw API slugs", () => {
  assert.equal(toApiSlug("unorouter/gpt-5.6-sol"), "gpt-5.6-sol:free");
  assert.equal(toApiSlug("unorouter/deepseek-v4-flash"), "deepseek-v4-flash:free");
  assert.equal(toApiSlug("unorouter/minimax-m3"), "minimax-m3:free");
  assert.equal(toApiSlug("unorouter/glm-5.3-flash-think-search"), "glm-5.3-flash-think-search:free");
  assert.equal(toApiSlug("unorouter/gemini-3.6-flash"), "gemini-3.6-flash:free");
  assert.equal(toApiSlug("unorouter/sarvam-30b"), "sarvam-30b:free");
  assert.equal(toApiSlug("unorouter/gpt-oss-120b"), "gpt-oss-120b:free");
  assert.equal(toApiSlug("unorouter/nemotron-3-ultra-550b-a55b"), "nemotron-3-ultra-550b-a55b:free");
  // Raw slugs pass through untouched.
  assert.equal(toApiSlug("some/custom-model"), "some/custom-model");
});

test("findModel accepts ids and raw slugs", () => {
  assert.equal(findModel("unorouter/sarvam-30b")?.provider, "unorouter");
  assert.equal(findModel("glm-5.3-flash-think-search:free")?.provider, "unorouter");
  assert.equal(findModel("nope"), undefined);
});

test("activeProvider follows the selected model", () => {
  assert.equal(activeProvider({ model: "unorouter/glm-5.3-flash-think-search" }), "unorouter");
  assert.equal(activeProvider({ model: "unorouter/sarvam-30b" }), "unorouter");
  assert.equal(activeModelId({ model: "gemini/gemini-3.8-flash" }), DEFAULT_MODEL_ID);
  assert.equal(activeModelId({ model: "gemini-3.8-flash" }), DEFAULT_MODEL_ID);
  assert.equal(activeProvider({ provider: "gemini", model: "gemini-2.5-pro" }), "gemini");
});

test("activeApiModel resolves the API slug for the selection", () => {
  assert.equal(activeApiModel({ model: "unorouter/sarvam-30b" }), "sarvam-30b:free");
  assert.equal(activeApiModel({}), "glm-5.3-flash-think-search:free");
  assert.equal(activeModelId({}), "unorouter/glm-5.3-flash-think-search");
});

test("modelLabel returns the plain model label with no provider branding", () => {
  assert.equal(modelLabel({ model: "unorouter/sarvam-30b" }), "Sarvam 30B");
  // Key presence doesn't change the label — no "via UnoRouter" style branding.
  assert.equal(modelLabel({ model: "unorouter/sarvam-30b", unorouterApiKey: "ur-test" }), "Sarvam 30B");
  assert.match(modelLabel({}), /GLM 5\.3/);
  const label = modelLabel({});
  assert.ok(!label.includes("via"), "no 'via X' provider branding");
  assert.ok(!label.includes("UnoRouter"));
});