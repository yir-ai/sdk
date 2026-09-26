import { createYirClient, validateGeneration, validateModelParameters } from "./catalog-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { quoteFixture } from "./quote-fixture.mjs";
import { YirSDKValidationError } from "../dist/index.js";

const image = () => ({
  model: "openai/gpt-image-2",
  input: { type: "text", prompt: "An observatory" },
  parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
});

test("dynamic parameters fail locally before either Quote or Submit transport", () => {
  let calls = 0;
  const client = createYirClient(async () => { calls++; return {}; });
  for (const parameters of [null, [], { n: "1" }, { n: 1.5 }, { n: NaN },
    { n: Infinity }, { n: Number.MAX_SAFE_INTEGER + 1 }, { n: 2 },
    { resolution: null }, { resolution: "unknown" }, { invented: true }]) {
    const request = { ...image(), parameters };
    for (const submit of [() => client.quoteImage(request), () => client.submitImage(request, "request-1")]) {
      assert.throws(submit, YirSDKValidationError);
    }
  }
  assert.throws(() => client.quoteImage({ ...image(), model: "future/model" }),
    error => error.code === "model_contract_unavailable");
  assert.throws(() => client.quoteImage({ ...image(), resolution: "1K" }),
    error => error.path === "request.resolution");
  assert.equal(calls, 0);
});

test("validation preserves input order, defaults and caller values", async () => {
  const references = [
    { role: "reference_image", url: "https://example.com/z.png" },
    { role: "reference_image", file_id: "file_11111111-1111-4111-8111-111111111111" },
  ];
  const request = { ...image(), input: { type: "image", prompt: "  Keep spaces  ", references }, parameters: {} };
  const snapshot = structuredClone(request);
  validateGeneration("generate_image", request);
  assert.deepEqual(request, snapshot);
  const calls = [];
  const client = createYirClient(async call => { calls.push(call); return quoteFixture(call.body); });
  await client.quoteImage(request);
  await client.submitImage(request, "request-1");
  assert.deepEqual(calls.map(call => call.body), [snapshot, snapshot]);
});

test("references reject ambiguous sources, invalid URL and unsupported roles", () => {
  for (const reference of [
    { role: "reference_image", url: "https://example.com/a", file_id: "file_1" },
    { role: "reference_image", url: "http://example.com/a" },
    { role: "reference_image", url: "https://secret@example.com/a" },
    { role: "reference_image", file_id: "file_1" },
    { role: "reference_audio", url: "https://example.com/a" },
  ]) {
    assert.throws(() => validateGeneration("generate_image", {
      ...image(), input: { type: "image", prompt: "Edit", references: [reference] },
    }), YirSDKValidationError);
  }
});

test("video image input requires exactly one first frame and at most one last frame", () => {
  const first = { role: "first_frame", url: "https://example.com/first.png" };
  const last = { role: "last_frame", url: "https://example.com/last.png" };
  const request = references => ({
    model: "bytedance/seedance-2.0", input: { type: "image", prompt: "Animate", references }, parameters: {},
  });
  validateGeneration("generate_video", request([last, first]));
  for (const references of [[last], [first, first], [first, last, last]]) {
    assert.throws(() => validateGeneration("generate_video", request(references)), YirSDKValidationError);
  }
});

test("validation errors do not echo supplied parameter values", () => {
  assert.throws(() => validateModelParameters("openai/gpt-image-2", "generate_image", "text", { resolution: "private-value" }),
    error => error.code === "parameter_value" && !error.message.includes("private-value"));
});
