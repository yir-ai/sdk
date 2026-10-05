import { createYirClient } from "./catalog-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";

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
