import assert from "node:assert/strict";
import test from "node:test";
import { createYirClient } from "../dist/server/index.js";
import { getModelOperationContract, listModelContracts, validateModelParameters } from "../dist/browser/index.js";
import { quoteFixture } from "./quote-fixture.mjs";

test("Seedance 2 last-frame intent survives quote and submit for every input mode", async () => {
  const model = "bytedance/seedance-2";
  const contract = getModelOperationContract(model, "generate_video", "text");
  const rule = contract.parameters.find(p => p.name === "return_last_frame");
  assert.equal(rule.type, "boolean");
  assert.equal(rule.required, false);
  assert.equal(rule.default, false);
  for (const mode of contract.input_modes) {
    const input = { type: mode, prompt: "fixture", ...(mode === "text" ? {} : { references: [{ role: mode === "image" ? "first_frame" : "reference_image", url: "https://example.com/image.png" }] }) };
    for (const parameters of [{}, { return_last_frame: false }, { return_last_frame: true }]) {
      const request = { model, input, parameters };
      const before = structuredClone(request);
      const calls = [];
      const client = createYirClient(async call => {
        calls.push(structuredClone(call));
        return call.path.endsWith("/quotes") ? { ...quoteFixture(call.body, "generate_video"), primary: { kind: "unavailable", amount: null, reason: "unverified_last_frame_cost" }, supply: { available: false, issues: ["unverified_last_frame_cost"] } } : { object: "job", id: "1", status: "queued" };
      });
      const quote = await client.quoteVideo(request);
      assert.equal(quote.primary.kind, "unavailable");
      assert.equal(quote.primary.amount, null);
      // Independently test serialization; this unavailable quote is not authorization.
      await client.submitVideo(request, "tail-key");
      assert.deepEqual(calls.map(c => c.body.parameters), [parameters, parameters]);
      assert.deepEqual(quote.parameters, parameters);
      assert.equal(calls[1].headers["Idempotency-Key"], "tail-key");
      assert.deepEqual(request, before);
    }
    for (const value of ["true", 1, null]) {
      let calls = 0;
      const client = createYirClient(async () => { calls++; throw new Error("unexpected transport"); });
      const request = { model, input, parameters: { return_last_frame: value } };
      assert.throws(() => client.quoteVideo(request), { code: "parameter_type" });
      assert.throws(() => client.submitVideo(request, "tail-key"), { code: "parameter_type" });
      assert.equal(calls, 0);
    }
  }
  for (const model of listModelContracts()) {
    if (model.id === "bytedance/seedance-2.0") continue;
    for (const op of model.operations) for (const mode of op.input_modes) for (const value of [false, true]) {
      assert.throws(() => validateModelParameters(model.id, op.operation, mode, { return_last_frame: value }), { code: "parameter_unknown" });
    }
  }
});
