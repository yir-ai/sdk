import assert from "node:assert/strict";
import test from "node:test";
import { experimental_startVideo as startVideo, experimental_getVideoStatus as getVideoStatus } from "ai";
import { createYirClient } from "../dist/server/client.js";
import { createYirAIProvider } from "../dist/server/vercel.js";
import { quoteFixture } from "./quote-fixture.mjs";

// Response fixtures pin the API echo contract; they do not simulate media measurement or billing.
for (const duration of ["auto", 6]) {
  test("URL quote and Job echoes remain reusable by AI SDK: " + duration, async () => {
    const model = "bytedance/seedance-2.5";
    const url = "https://example.com/reference.mp4";
    const parameters = { duration, resolution: "480p", aspect_ratio: "auto", generate_audio: false, n: 1 };
    const request = { model, input: { type: "reference", prompt: "Edit", references: [{ role: "reference_video", url }] }, parameters };
    const quote = { ...quoteFixture(request, "generate_video"),
      primary: { kind: "unavailable", amount: null, reason: "complete_price_unavailable" },
      official: { kind: "unavailable", amount: null, reason: "official_price_unavailable" } };
    const calls = [];
    const client = createYirClient(async call => {
      calls.push(call);
      if (call.path === "/v1/videos/quotes") return structuredClone(quote);
      if (call.path === "/v1/quotes") return { object: "quote_batch", request_id: "batch", data: [{ index: 0, quote: structuredClone(quote) }] };
      if (call.path === "/v1/videos/generations") return { id: "42", status: "queued", created_at: 1, parameters: structuredClone(parameters) };
      if (call.path === "/v1/jobs/42") return { id: "42", status: "succeeded", created_at: 1, parameters: structuredClone(parameters),
        result: { availability: "available", files: [{ url: "https://example.com/output.mp4", media_type: "video/mp4" }] } };
      throw new Error("Unexpected request: " + call.path);
    });
    const single = await client.quoteVideo(request);
    const batch = await client.quoteBatch([{ operation: "generate_video", request }]);
    assert.equal(single.parameters.duration, duration);
    assert.equal(single.supply.available, true);
    assert.equal(single.primary.amount, null);
    assert.equal(single.expected_amount, undefined);
    assert.deepEqual(batch.data[0].quote.parameters, single.parameters);
    const before = structuredClone(single.parameters);
    const provider = createYirAIProvider({ client, fetch: async () => { throw new Error("URL input must not download locally"); } });
    const started = await startVideo({ model: provider.videoModel(model), prompt: "Edit", aspectRatio: "adaptive", maxRetries: 0,
      inputReferences: [{ data: url, mediaType: "video/mp4" }], providerOptions: { yir: { parameters: single.parameters } } });
    const submission = calls.find(call => call.path === "/v1/videos/generations");
    assert.deepEqual(submission.body.parameters, parameters);
    assert.deepEqual(submission.body.input, request.input);
    assert.deepEqual(single.parameters, before);
    const restored = createYirAIProvider({ client }).videoModel(model);
    const status = await getVideoStatus(restored, { operation: started.operation, maxRetries: 0 });
    assert.equal(status.status, "completed");
    const job = await client.getJob("42");
    assert.deepEqual(job.parameters, parameters);
    assert.equal(calls.filter(call => call.path === "/v1/videos/generations").length, 1);
    assert.equal(calls.length, 5);
    // A numeric standard option may not overwrite the native auto echo.
    if (duration === "auto") {
      await assert.rejects(() => startVideo({ model: restored, prompt: "Edit", duration: 6, maxRetries: 0,
        inputReferences: [{ data: url, mediaType: "video/mp4" }], providerOptions: { yir: { parameters: job.parameters } } }), /parameter_conflict/);
      assert.equal(calls.length, 5);
    }
  });
}
