import assert from "node:assert/strict";
import test from "node:test";
import { validateGeneration } from "../dist/index.js";

test("actual billing preserves explicit consent and rejects conflicting caps", () => {
  const request = {
    model: "bfl/flux-2-pro",
    input: { type: "image", prompt: "fixture", references: [{ role: "reference_image", file_id: "file_11111111-1111-4111-8111-111111111111" }] },
    parameters: { resolution: "1MP", aspect_ratio: "1:1", n: 1 },
    routing: { only: ["fal"] }, billing_mode: "actual",
  };
  assert.doesNotThrow(() => validateGeneration("generate_image", request));
  assert.throws(() => validateGeneration("generate_image", { ...request, max_cost: "0.1" }), error => error.path === "max_cost");
  assert.throws(() => validateGeneration("generate_image", { ...request, billing_mode: "unknown" }), error => error.path === "billing_mode");
  assert.throws(() => validateGeneration("generate_image", { ...request, routing: { only: [] } }), error => error.path === "routing.only");
  const { billing_mode, ...capped } = request;
  assert.equal(billing_mode, "actual");
  assert.doesNotThrow(() => validateGeneration("generate_image", { ...capped, max_cost: "0.1" }));
});
