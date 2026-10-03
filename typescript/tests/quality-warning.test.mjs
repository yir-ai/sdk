import { createYirClient } from "./catalog-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { checkParameterPolicies } from "../dist/shared/parameter-rules.js";
import { getModelOperationContract } from "../dist/shared/model-contracts.js";

test("parameter diagnostics follow the declared parameter and provider, without model-name rules", () => {
  const contract = structuredClone(getModelOperationContract("gpt-image-2", "generate_image", "text"));
  const parameter = contract.parameters.find(p => p.name === "quality");
  parameter.name = "custom_parameter";
  parameter.policy = { only_provider: "declared-provider", reason: "declared_reason", message: "Declared safe warning" };
  const parameters = Object.freeze({ custom_parameter: "secret value" });
  assert.equal(checkParameterPolicies(contract, parameters)[0].message, "Declared safe warning");
  assert.deepEqual(checkParameterPolicies(contract, parameters, ["declared-provider"]), []);
  assert.equal(checkParameterPolicies(contract, parameters, ["declared-provider", "other"]).length, 1);
  assert.deepEqual(checkParameterPolicies(contract, {}), []);
  assert.deepEqual(checkParameterPolicies(contract, { custom_parameter: undefined }), []);
  assert.ok(!JSON.stringify(checkParameterPolicies(contract, parameters)).includes("secret value"));
});

// GPT Image quality is a routing constraint on the server: channels that do not serve the tier are excluded, so the SDK no longer warns.
test("GPT Image quality no longer triggers a warning for any routing", async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const client = createYirClient(async () => ({ id: "42", status: "succeeded" }));
    for (const only of [undefined, ["apimart"], ["openai", "apimart"], ["openai"]]) {
      const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "private prompt" }, parameters: { resolution: "1K", aspect_ratio: "1:1", quality: "high" }, ...(only ? { routing: { only } } : {}) };
      const count = warnings.length;
      await client.submitImage(request, "test-idempotency");
      assert.equal(warnings.length - count, 0);
      assert.equal(request.parameters.quality, "high");
    }
    await client.getJob("42");
    await client.submitImage({ model: "gpt-image-2", input: { type: "text", prompt: "private prompt" }, parameters: { resolution: "1K", aspect_ratio: "1:1" } }, "without-quality");
    assert.equal(warnings.length, 0);
  } finally { console.warn = original; }
});
