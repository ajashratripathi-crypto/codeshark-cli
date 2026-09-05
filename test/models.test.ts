import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, DEFAULT_MODEL_ID, findModel, toApiSlug } from "../dist/models.js";
import { activeApiModel, activeModelId, activeProvider, modelLabel } from "../dist/config.js";

test("catalog contains exactly the five launch models", () => {
  const ids = MODELS.map((m) => m.id);
  assert.deepEqual(ids, [
    "unorouter/gpt-5.6-sol",
    "unorouter/deepseek-v4-flash",
    "unorouter/glm-5.3-flash-thinking",
    "unorouter/kimi-k3",
    "unorouter/gemini-3.6-flash",
  ]);
  assert.equal(DEFAULT_MODEL_ID, "unorouter/glm-5.3-flash-thinking");
});

test("every catalog model is an UnoRouter model", () => {
  for (const m of MODELS) {
    assert.equal(m.provider, "unorouter");
    assert.ok(m.model.endsWith(":free"), `${m.id} must use a :free slug`);
  }
});

test("catalog ids map to the correct raw API slugs", () => {
  assert.equal(toApiSlug("unorouter/gpt-5.6-sol"), "gpt-5.6-sol:free");
  assert.equal(toApiSlug("unorouter/deepseek-v4-flash"), "deepseek-v4-flash-0731:free");
  assert.equal(toApiSlug("unorouter/glm-5.3-flash-thinking"), "glm-5.3-flash-thinking:free");
  assert.equal(toApiSlug("unorouter/kimi-k3"), "kimi-k3:free");
  assert.equal(toApiSlug("unorouter/gemini-3.6-flash"), "gemini-3.6-flash:free");
  // Raw slugs pass through untouched.
  assert.equal(toApiSlug("some/custom-model"), "some/custom-model");
});

test("findModel accepts ids and raw slugs", () => {
  assert.equal(findModel("unorouter/kimi-k3")?.provider, "unorouter");
  assert.equal(findModel("glm-5.3-flash-thinking:free")?.provider, "unorouter");
  assert.equal(findModel("nope"), undefined);
});

test("activeProvider follows the selected model", () => {
  assert.equal(activeProvider({ model: "unorouter/glm-5.3-flash-thinking" }), "unorouter");
  assert.equal(activeProvider({ model: "unorouter/kimi-k3" }), "unorouter");
  assert.equal(activeProvider({ provider: "gemini", model: "gemini-2.5-pro" }), "gemini");
});

test("activeApiModel resolves the API slug for the selection", () => {
  assert.equal(activeApiModel({ model: "unorouter/kimi-k3" }), "kimi-k3:free");
  assert.equal(activeApiModel({}), "glm-5.3-flash-thinking:free");
  assert.equal(activeModelId({}), "unorouter/glm-5.3-flash-thinking");
});

test("modelLabel returns the plain model label with no provider branding", () => {
  assert.equal(modelLabel({ model: "unorouter/gpt-5.6-sol" }), "Chat-GPT 5.6 Sol");
  // Key presence doesn't change the label — no "via UnoRouter" style branding.
  assert.equal(modelLabel({ model: "unorouter/gpt-5.6-sol", unorouterApiKey: "ur-test" }), "Chat-GPT 5.6 Sol");
  assert.match(modelLabel({}), /GLM 5\.3/);
  const label = modelLabel({});
  assert.ok(!label.includes("via"), "no 'via X' provider branding");
  assert.ok(!label.includes("UnoRouter"));
});