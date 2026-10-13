import assert from "node:assert/strict";
import test from "node:test";
import { catalog, createYirClient, validateGeneration } from "./catalog-fixture.mjs";
import { createYirClient as createBareClient, createNodeYirClient, validateGeneration as validateProtocol, YirSDKValidationError } from "../dist/index.js";

const musicQuote = (request, overrides = {}) => ({
  supply: { available: true, issues: [] },
  object: "quote", model: "minimax/music-2.6", operation: "generate_music", input_mode: "text",
  // A music echo carries no resolution or aspect_ratio.
  parameters: { instrumental: false, lyrics_optimizer: request.parameters?.lyrics_optimizer ?? false, n: 1 },
  currency: "USD", expires_at: 1900000000,
  primary: { kind: "fixed", amount: request.parameters?.lyrics_optimizer ? "0.16" : "0.15" },
  official: { kind: "fixed", amount: "0.15" },
  ...overrides,
});

const vocal = {
  model: "music-2.6",
  input: { type: "text", prompt: "A warm acoustic folk ballad", lyrics: "[Verse]\nWalking down a dusty road" },
};

test("music Quote and Submit use the music paths and validate the music echo", async () => {
  const calls = [];
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path.endsWith("/quotes")) return musicQuote(request.body);
    return { id: "7101", object: "job", status: "queued", model: "minimax/music-2.6", error: null, created_at: 1 };
  });
  const quote = await client.quoteMusic(vocal);
  assert.equal(quote.operation, "generate_music");
  assert.equal(quote.parameters.resolution, undefined);
  assert.equal((await client.quoteMusic({ ...vocal, input: { type: "text", prompt: "A ballad" }, parameters: { lyrics_optimizer: true } })).primary.amount, "0.16");
  const submit = { ...vocal, webhook_url: "https://example.com/webhooks/yir", max_cost: "0.20" };
  await client.submitMusic(submit, "music-7101");
  assert.deepEqual(calls.map(call => [call.method, call.path]), [
    ["POST", "/v1/music/quotes"], ["POST", "/v1/music/quotes"], ["POST", "/v1/music/generations"],
  ]);
  // Omitted parameters are sent as omitted; the Gateway applies the published defaults.
  assert.deepEqual(calls[0].body, vocal);
  assert.deepEqual(calls[2].headers, { "Idempotency-Key": "music-7101" });
  assert.deepEqual(calls[2].body, submit);
  assert.throws(() => client.submitMusic(vocal, " "), /idempotency_key_invalid/);
});

test("music quote rejects an echo for another operation or input mode", async () => {
  for (const overrides of [{ operation: "generate_image" }, { input_mode: "image" }, { currency: "EUR" }]) {
    const client = createBareClient(async request => musicQuote(request.body, overrides));
    await assert.rejects(client.quoteMusic(vocal), /quote_(response_invalid|currency_unsupported)/);
  }
});

test("music requests enforce the lyrics, instrumental and lyrics optimizer rules before transport", () => {
  const valid = [
    vocal,
    { ...vocal, parameters: { instrumental: false, lyrics_optimizer: false, n: 1 } },
    { model: "music-2.6", input: { type: "text", prompt: "Lo-fi piano" }, parameters: { instrumental: true } },
    { model: "music-2.6", input: { type: "text", prompt: "A ballad" }, parameters: { lyrics_optimizer: true } },
  ];
  for (const request of valid) {
    validateProtocol("generate_music", request);
    validateGeneration("generate_music", request);
  }
  const invalid = [
    [{ model: "music-2.6", input: { type: "text", prompt: "A ballad" } }, "lyrics_required", "input.lyrics"],
    [{ ...vocal, parameters: { instrumental: true } }, "lyrics_not_allowed", "input.lyrics"],
    [{ ...vocal, parameters: { lyrics_optimizer: true } }, "lyrics_not_allowed", "input.lyrics"],
    [{ model: "music-2.6", input: { type: "text", prompt: "x" }, parameters: { instrumental: true, lyrics_optimizer: true } },
      "parameter_conflict", "parameters.lyrics_optimizer"],
    [{ ...vocal, input: { ...vocal.input, lyrics: "  " } }, "lyrics_invalid", "input.lyrics"],
    [{ ...vocal, parameters: { instrumental: "true" } }, "parameter_type", "parameters.instrumental"],
    [{ ...vocal, input: { ...vocal.input, prompt: " " } }, "prompt_required", "input.prompt"],
    [{ ...vocal, input: { ...vocal.input, type: "image", references: [{ role: "reference_image", url: "https://example.com/a.png" }] } },
      "input_mode_invalid", "input.type"],
    [{ ...vocal, parameters: null }, "object_required", "parameters"],
  ];
  for (const [request, code, path] of invalid) {
    assert.throws(() => validateProtocol("generate_music", request),
      error => error instanceof YirSDKValidationError && error.code === code && error.path === path, code);
  }
  // The current catalog also checks parameter values.
  assert.throws(() => validateGeneration("generate_music", { ...vocal, parameters: { n: 2 } }),
    error => error.code === "parameter_value" && error.path === "parameters.n");
  assert.throws(() => validateGeneration("generate_music", { ...vocal, parameters: { duration: 30 } }),
    error => error.code === "parameter_unknown");
});

test("music is part of the bundled catalog snapshot", () => {
  const model = catalog.models.find(item => item.id === "minimax/music-2.6");
  assert.deepEqual(model.aliases, ["music-2.6"]);
  assert.deepEqual(model.operations.map(operation => [operation.operation, operation.input_modes]), [["generate_music", ["text"]]]);
  assert.deepEqual(model.operations[0].parameters.map(parameter => parameter.name), ["instrumental", "lyrics_optimizer", "n"]);
});

test("batch quote accepts a music item", async () => {
  const client = createYirClient(async request => ({
    object: "quote_batch", request_id: "req_music",
    data: [{ index: 0, quote: musicQuote(request.body.requests[0].request) }],
  }));
  const batch = await client.quoteBatch([{ operation: "generate_music", request: vocal }]);
  assert.equal(batch.data[0].quote.operation, "generate_music");
});

test("the Node transport retries music submits with the same key and body", async () => {
  const seen = [];
  const client = createNodeYirClient({
    apiKey: "test-key", baseURL: "https://gateway.example",
    fetch: async (url, init) => {
      seen.push({ url, key: new Headers(init.headers).get("Idempotency-Key"), body: init.body });
      if (seen.length === 1) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ id: "7102", object: "job", status: "queued" }), {
        status: 202, headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal((await client.submitMusic(vocal, "music-retry")).id, "7102");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "https://gateway.example/v1/music/generations");
  assert.deepEqual(seen.map(item => item.key), ["music-retry", "music-retry"]);
  assert.equal(seen[0].body, seen[1].body);
});
