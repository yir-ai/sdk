import assert from "node:assert/strict";
import test from "node:test";
import { createYirClient } from "../dist/index.js";
import { quoteFixture } from "./quote-fixture.mjs";

const image = { model: "openai/gpt-image-2", input: { type: "text", prompt: "image" }, parameters: {} };
const video = { model: "bytedance/seedance-2.5", input: { type: "text", prompt: "video" }, parameters: { duration: 6 } };
const requests = [
  { operation: "generate_image", request: image },
  { operation: "generate_video", request: video },
];

test("batch quote preserves valid prices and per-model invalid requests", async () => {
  const response = { object: "quote_batch", request_id: "test-request", data: [
    { index: 0, quote: quoteFixture(image) },
    { index: 1, error: { code: "YIR_INVALID_REQUEST", message: "The request is invalid.", retryable: false, action: "fix_request" } },
  ] };
  const client = createYirClient(async request => {
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/v1/quotes");
    assert.deepEqual(request.body, { requests });
    return response;
  });
  assert.deepEqual(await client.quoteBatch(requests), response);
});

test("batch quote rejects mismatched or malformed result positions", async () => {
  const valid = { object: "quote_batch", request_id: "test-request", data: [
    { index: 0, quote: quoteFixture(image) },
    { index: 1, quote: quoteFixture(video, "generate_video") },
  ] };
  for (const bad of [
    { ...valid, data: [valid.data[1], valid.data[0]] },
    { ...valid, data: [valid.data[0]] },
    { ...valid, data: [{ index: 0, quote: { ...valid.data[0].quote, model: video.model } }, valid.data[1]] },
    { ...valid, data: [{ index: 0, error: { code: "YIR_INVALID_REQUEST", message: "bad", retryable: false, action: "fix_request" }, quote: valid.data[0].quote }, valid.data[1]] },
    { ...valid, data: [valid.data[0], { index: 1, error: { code: "YIR_TEMPORARILY_UNAVAILABLE", message: "bad", retryable: true, action: "retry_later" } }] },
  ]) {
    const client = createYirClient(async () => bad);
    await assert.rejects(client.quoteBatch(requests), { message: "quote_batch_response_invalid" });
  }
});

test("batch quote rejects unbounded request counts before transport", () => {
  const client = createYirClient(async () => { throw new Error("transport_must_not_run"); });
  assert.throws(() => client.quoteBatch([]), /quote_batch_request_invalid/);
  assert.throws(() => client.quoteBatch(Array(21).fill(requests[0])), /quote_batch_request_invalid/);
});
