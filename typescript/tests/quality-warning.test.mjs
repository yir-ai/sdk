import { createYirClient } from "./catalog-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { checkParameterPolicies } from "../dist/shared/parameter-rules.js";
import { getModelOperationContract } from "../dist/shared/model-contracts.js";

test("parameter diagnostics follow the declared parameter and provider, without model-name rules", () => {
  const contract = structuredClone(getModelOperationContract("gpt-image-2", "generate_image", "text"));
  const parameter = contract.parameters.find(p => p.name === "quality");
  parameter.name = "custom_parameter";
  parameter.policy.only_provider = "declared-provider";
  parameter.policy.message = "Declared safe warning";
  const parameters = Object.freeze({ custom_parameter: "secret value" });
  assert.equal(checkParameterPolicies(contract, parameters)[0].message, "Declared safe warning");
  assert.deepEqual(checkParameterPolicies(contract, parameters, ["declared-provider"]), []);
  assert.equal(checkParameterPolicies(contract, parameters, ["declared-provider", "other"]).length, 1);
  assert.deepEqual(checkParameterPolicies(contract, {}), []);
  assert.deepEqual(checkParameterPolicies(contract, { custom_parameter: undefined }), []);
  assert.ok(!JSON.stringify(checkParameterPolicies(contract, parameters)).includes("secret value"));
});

test("GPT Image warns once per submission unless explicitly official; polling stays quiet", async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const client = createYirClient(async () => ({ id: "42", status: "succeeded" }));
    for (const only of [undefined, ["apimart"], ["openai", "apimart"], ["openai"]]) {
      const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "private prompt" }, parameters: { resolution: "1K", aspect_ratio: "1:1", quality: "high" }, ...(only ? { routing: { only } } : {}) };
      const count = warnings.length;
      await client.submitImage(request, "test-idempotency");
      assert.equal(warnings.length - count, only?.length === 1 && only[0] === "openai" ? 0 : 1);
      assert.equal(request.parameters.quality, "high");
    }
    await client.getJob("42");
    await client.submitImage({ model: "gpt-image-2", input: { type: "text", prompt: "private prompt" }, parameters: { resolution: "1K", aspect_ratio: "1:1" } }, "without-quality");
    assert.equal(warnings.length, 3);
    assert.ok(warnings.every(message => message === '[Yir] GPT Image quality is ignored unless routing.only is ["openai"].'));
  } finally { console.warn = original; }
});
