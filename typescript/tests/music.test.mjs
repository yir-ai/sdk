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

test("audio Quote and Submit use the audio paths; the music methods stay on the legacy paths", async () => {
  const calls = [];
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path.endsWith("/quotes")) return musicQuote(request.body);
    return { id: "7103", object: "job", status: "queued", model: "minimax/music-2.6", error: null, created_at: 1 };
  });
  assert.equal((await client.quoteAudio(vocal)).operation, "generate_music");
  await client.submitAudio({ ...vocal, max_cost: "0.20" }, "audio-7103");
  assert.deepEqual(calls.map(call => [call.method, call.path]), [["POST", "/v1/audio/quotes"], ["POST", "/v1/audio/generations"]]);
  assert.deepEqual(calls[1].headers, { "Idempotency-Key": "audio-7103" });
  assert.throws(() => client.submitAudio(vocal, " "), /idempotency_key_invalid/);
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
  // Without a catalog the model may be a sound effect, so only the catalog requires a lyrics source for music.
  const noLyricsSource = { model: "music-2.6", input: { type: "text", prompt: "A ballad" } };
  validateProtocol("generate_music", noLyricsSource);
  assert.throws(() => validateGeneration("generate_music", noLyricsSource),
    error => error.code === "lyrics_required" && error.path === "input.lyrics");
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

test("the Node transport retries audio submits with the same key", async () => {
  const seen = [];
  const client = createNodeYirClient({
    apiKey: "test-key", baseURL: "https://gateway.example",
    fetch: async (url, init) => {
      seen.push({ url, key: new Headers(init.headers).get("Idempotency-Key") });
      if (seen.length === 1) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ id: "7104", object: "job", status: "queued" }), {
        status: 202, headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal((await client.submitAudio(vocal, "audio-retry")).id, "7104");
  assert.deepEqual(seen.map(item => [item.url, item.key]), [
    ["https://gateway.example/v1/audio/generations", "audio-retry"], ["https://gateway.example/v1/audio/generations", "audio-retry"],
  ]);
});

test("audio models follow their contract for n, duration and lyrics sources", () => {
  const request = (model, parameters, lyrics) => ({
    model, input: { type: "text", prompt: "Rain on a tin roof", ...(lyrics ? { lyrics } : {}) },
    ...(parameters ? { parameters } : {}),
  });
  const valid = [
    ["generate_music", request("suno/suno-v6", undefined, "[Verse]\nRain")],
    ["generate_music", request("suno/suno-v6", { n: 2, lyrics_optimizer: true })],
    ["generate_music", request("elevenlabs/music-v2", { duration: 120, instrumental: true })],
    ["generate_music", request("elevenlabs/music-v2.5", { lyrics_optimizer: true })],
    ["generate_music", request("minimax/music-3", undefined, "[Verse]\nRain")],
    // The music methods also serve sound effects; no lyrics source is needed.
    ["generate_music", request("elevenlabs/sound-effects-v2", { duration: 22 })],
    ["generate_sound_effect", request("elevenlabs/sound-effects-v2")],
  ];
  for (const [operation, body] of valid) {
    validateProtocol(operation, body);
    validateGeneration(operation, body);
  }
  const invalid = [
    [request("suno/suno-v6", { n: 1 }, "[Verse]"), "parameter_value", "parameters.n"],
    [request("elevenlabs/music-v2", { duration: 45, instrumental: true }), "parameter_value", "parameters.duration"],
    [request("elevenlabs/music-v2", { duration: 600, instrumental: true }), "parameter_range", "parameters.duration"],
    [request("elevenlabs/music-v2"), "lyrics_required", "input.lyrics"],
    [request("elevenlabs/sound-effects-v2", { duration: 23 }), "parameter_range", "parameters.duration"],
    [request("elevenlabs/sound-effects-v2", { instrumental: true }), "parameter_unknown", "parameters.instrumental"],
    [request("elevenlabs/sound-effects-v2", undefined, "[Verse]"), "lyrics_not_allowed", "input.lyrics"],
    [request("minimax/music-3", { lyrics_optimizer: true }), "parameter_unknown", "parameters.lyrics_optimizer"],
    [request("minimax/music-2.6", { duration: 60 }, "[Verse]"), "parameter_unknown", "parameters.duration"],
  ];
  for (const [body, code, path] of invalid) {
    assert.throws(() => validateGeneration("generate_music", body),
      error => error instanceof YirSDKValidationError && error.code === code && error.path === path, `${body.model} ${code}`);
  }
  // An explicit sound-effect operation rejects lyrics without a catalog.
  assert.throws(() => validateProtocol("generate_sound_effect", request("elevenlabs/sound-effects-v2", undefined, "[Verse]")),
    error => error.code === "lyrics_not_allowed");
});

test("sound effects quote through the music methods and Suno delivers two tracks", async () => {
  const soundQuote = {
    supply: { available: true, issues: [] }, object: "quote", model: "elevenlabs/sound-effects-v2",
    operation: "generate_sound_effect", input_mode: "text", parameters: { n: 1, duration: 5 },
    currency: "USD", expires_at: 1900000000,
    primary: { kind: "fixed", amount: "0.01" }, official: { kind: "fixed", amount: "0.01" },
  };
  const sound = { model: "elevenlabs/sound-effects-v2", input: { type: "text", prompt: "Glass shattering" } };
  for (const client of [createYirClient(async () => soundQuote), createBareClient(async () => soundQuote)]) {
    assert.equal((await client.quoteMusic(sound)).operation, "generate_sound_effect");
  }
  const batchClient = createYirClient(async () => ({ object: "quote_batch", request_id: "req_sfx", data: [{ index: 0, quote: soundQuote }] }));
  assert.equal((await batchClient.quoteBatch([{ operation: "generate_sound_effect", request: sound }])).data[0].quote.operation, "generate_sound_effect");
  const job = {
    id: "7201", object: "job", status: "succeeded", model: "suno/suno-v6", error: null, created_at: 1,
    result: { availability: "available", files: [
      { url: "https://example.com/a.mp3", media_type: "audio/mpeg", duration_ms: 120000, expires_at: 2 },
      { url: "https://example.com/b.mp3", media_type: "audio/mpeg", duration_ms: 118000, expires_at: 2 },
    ] },
  };
  const fetched = await createBareClient(async () => job).getJob("7201");
  assert.deepEqual(fetched.result.files.map(file => file.duration_ms), [120000, 118000]);
});

test("text-to-speech models take only n and voice through the music methods", async () => {
  const request = (model, parameters, lyrics) => ({
    model, input: { type: "text", prompt: "Welcome to Yir.", ...(lyrics ? { lyrics } : {}) },
    ...(parameters ? { parameters } : {}),
  });
  const valid = [
    ["generate_music", request("minimax/speech-2.8-hd")],
    ["generate_music", request("speech-2.8-hd", { voice: "Chinese (Mandarin)_News_Anchor" })],
    ["generate_music", request("elevenlabs/eleven-v3", { n: 1, voice: "JBFqnCBsd6RMkjVDRZzb" })],
    ["generate_speech", request("eleven_v3")],
  ];
  for (const [operation, body] of valid) {
    validateProtocol(operation, body);
    validateGeneration(operation, body);
  }
  const invalid = [
    [request("minimax/speech-2.8-hd", undefined, "[Verse]"), "lyrics_not_allowed", "input.lyrics"],
    [request("minimax/speech-2.8-hd", { instrumental: true }), "parameter_unknown", "parameters.instrumental"],
    [request("elevenlabs/eleven-v3", { duration: 10 }), "parameter_unknown", "parameters.duration"],
    [request("elevenlabs/eleven-v3", { n: 2 }), "parameter_value", "parameters.n"],
    [request("elevenlabs/eleven-v3", { voice: "bad/voice" }), "voice_invalid", "parameters.voice"],
    [request("elevenlabs/eleven-v3", { voice: 7 }), "parameter_type", "parameters.voice"],
    // A voice is a text-to-speech parameter; music contracts do not declare it.
    [request("minimax/music-2.6", { voice: "English_expressive_narrator" }, "[Verse]"), "parameter_unknown", "parameters.voice"],
  ];
  for (const [body, code, path] of invalid) {
    assert.throws(() => validateGeneration("generate_music", body),
      error => error instanceof YirSDKValidationError && error.code === code && error.path === path, `${body.model} ${code}`);
  }
  // An explicit speech operation rejects lyrics and music switches without a catalog.
  for (const [body, path] of [
    [request("minimax/speech-2.8-hd", undefined, "[Verse]"), "input.lyrics"],
    [request("minimax/speech-2.8-hd", { lyrics_optimizer: false }), "parameters.lyrics_optimizer"],
    [request("minimax/speech-2.8-hd", { duration: 30 }), "parameters.duration"],
  ]) {
    assert.throws(() => validateProtocol("generate_speech", body), error => error.path === path);
  }

  const speechQuote = {
    supply: { available: true, issues: [] }, object: "quote", model: "minimax/speech-2.8-hd",
    operation: "generate_speech", input_mode: "text", parameters: { n: 1, voice: "English_expressive_narrator" },
    currency: "USD", expires_at: 1900000000,
    primary: { kind: "fixed", amount: "0.0015" }, official: { kind: "fixed", amount: "0.0015" },
  };
  const speech = request("minimax/speech-2.8-hd");
  for (const client of [createYirClient(async () => speechQuote), createBareClient(async () => speechQuote)]) {
    const quote = await client.quoteMusic(speech);
    assert.equal(quote.operation, "generate_speech");
    assert.equal(quote.parameters.voice, "English_expressive_narrator");
  }
  const batchClient = createYirClient(async () => ({ object: "quote_batch", request_id: "req_tts", data: [{ index: 0, quote: speechQuote }] }));
  assert.equal((await batchClient.quoteBatch([{ operation: "generate_speech", request: speech }])).data[0].quote.operation, "generate_speech");
});
