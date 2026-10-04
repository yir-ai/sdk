import { buildImageQuoteRequest, createYirClient, validateModelParameters } from "./catalog-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { getModelOperationContract, listModelContracts } from "../dist/browser/index.js";
import { quoteFixture } from "./quote-fixture.mjs";

const model = "google/nano-banana-2";
const input = mode => mode === "text" ? { type: mode, prompt: "fixture" }
  : { type: mode, prompt: "fixture", references: [{ role: "reference_image", file_id: "file_11111111-1111-4111-8111-111111111111" }] };

test("explicit Nano2 contract validates search field types; semantic dependencies remain server-owned", async () => {
  for (const mode of ["text", "image"]) {
    const contract = getModelOperationContract(model, "generate_image", mode);
    for (const name of ["web_search", "image_search"]) {
      const rule = contract.parameters.find(parameter => parameter.name === name);
      assert.equal(rule.type, "boolean");
      assert.equal(rule.required, false);
      assert.equal(rule.default, false);
    }
    for (const parameters of [{}, { image_search: true }, { web_search: false, image_search: true }, { web_search: false, image_search: false }, { web_search: true }, { web_search: true, image_search: false }, { web_search: true, image_search: true }]) {
      const request = { model, input: input(mode), parameters };
      const before = structuredClone(request);
      const calls = [];
      const client = createYirClient(async call => {
        calls.push(structuredClone(call));
        return call.path.endsWith("/quotes") ? quoteFixture(call.body) : { object: "job", id: "1", status: "queued" };
      });
      validateModelParameters(model, "generate_image", mode, parameters);
      const quote = await client.quoteImage(request);
      await client.submitImage({ ...request, max_cost: "0.05" }, "saved-key");
      assert.deepEqual(quote.parameters, parameters);
      assert.deepEqual(calls.map(call => call.body.parameters), [parameters, parameters]);
      assert.equal(calls[1].headers["Idempotency-Key"], "saved-key");
      assert.deepEqual(request, before, "validation must preserve omitted and explicit false values");
    }
    for (const [parameters, code, path] of [
      [{ web_search: "true" }, "parameter_type", "parameters.web_search"],
      [{ web_search: true, image_search: null }, "parameter_type", "parameters.image_search"],
    ]) {
      let calls = 0;
      const client = createYirClient(async () => { calls++; throw new Error("unexpected transport"); });
      const request = { model, input: input(mode), parameters };
      assert.throws(() => validateModelParameters(model, "generate_image", mode, parameters), { code, path });
      assert.throws(() => client.quoteImage(request), { code, path });
      assert.throws(() => client.submitImage(request, "saved-key"), { code, path });
      assert.equal(calls, 0);
    }
  }
});

test("models reject unsupported search fields, including explicit false", () => {
  for (const contract of listModelContracts()) {
    if (contract.id === model) continue;
    for (const operation of contract.operations) {
      for (const mode of operation.input_modes) {
        for (const name of ["web_search", "image_search"]) {
          assert.throws(() => validateModelParameters(contract.id, operation.operation, mode, { [name]: false }),
            { code: "parameter_unknown", path: `parameters.${name}` });
        }
      }
    }
  }
});

test("builders retain search intent and unavailable quotes remain unavailable", async () => {
  const parameters = { web_search: true, image_search: true };
  const request = buildImageQuoteRequest({ model, prompt: "fixture", parameters });
  assert.deepEqual(request.parameters, parameters);
  const client = createYirClient(async () => ({
    ...quoteFixture(request), supply: { available: false, requires_max_cost: false, issues: ["no_matching_supply"] },
    primary: { kind: "unavailable", amount: null, reason: "no_matching_supply" },
    max: { kind: "unavailable", amount: null, reason: "no_matching_supply" },
    has_verifiable_upper_bound: false, single_attempt_upper_bound: null,
  }));
  const quote = await client.quoteImage(request);
  assert.equal(quote.supply.available, false);
  assert.equal(quote.primary.kind, "unavailable");
  assert.equal(quote.primary.amount, null);
  assert.equal(quote.single_attempt_upper_bound, null);
});
