import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createNodeYirClient, createYirClient, getDemoJob, getDemoJobStatus, isDemoJobID, isValidJobID, YirAPIError,
} from "../dist/index.js";
import { DEMO_ASSETS } from "../dist/shared/demo-assets.js";

const fixture = JSON.parse(readFileSync(new URL("../../spec/fixtures/demo-jobs.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../../spec/demo-assets.json", import.meta.url), "utf8"));

const image = {
  model: "openai/gpt-image-2",
  input: { type: "text", prompt: "A red cup on a table" },
  parameters: { aspect_ratio: "16:9", resolution: "2K", n: 2 },
};
const echo = { image: { aspect_ratio: "16:9", resolution: "2K", n: 2, quality: "auto" } };

function quoteFor(body, operation, parameters) {
  return {
    supply: { available: true, issues: [] }, object: "quote", model: body.model, operation, input_mode: body.input.type,
    parameters, currency: "USD", expires_at: 1900000000,
    primary: { kind: "fixed", amount: "0.04" }, official: { kind: "fixed", amount: "0.08" },
  };
}

// Answers quotes like the Gateway would; any other path fails the test.
function gateway(calls, parameters = echo.image, operation = "generate_image") {
  return async request => {
    calls.push(request);
    if (!request.path.endsWith("/quotes")) throw new Error(`unexpected ${request.method} ${request.path}`);
    return quoteFor(request.body, operation, parameters);
  };
}

function at(ms, run) {
  const original = Date.now;
  Date.now = () => ms;
  return Promise.resolve().then(run).finally(() => { Date.now = original; });
}

test("demo submit validates through the quote path and never reaches generations", async () => {
  const calls = [];
  const client = createYirClient(gateway(calls), undefined, { demo: true });
  const job = await client.submitImage({ ...image, webhook_url: "https://example.com/hook", max_cost: "1.00" }, "key-1");
  assert.deepEqual(calls.map(call => [call.method, call.path]), [["POST", "/v1/images/quotes"]]);
  // Submit-only fields stay out of the quote body.
  assert.deepEqual(calls[0].body, image);
  assert.equal(calls[0].headers, undefined);
  assert.ok(isDemoJobID(job.id) && isValidJobID(job.id));
  assert.equal(job.status, "queued");
  assert.equal(job.model, "openai/gpt-image-2");
  assert.deepEqual(job.parameters, echo.image);
  assert.equal(job.billing.total_charged_by_yir, "0");
});

test("demo video and audio submits use their quote paths", async () => {
  const calls = [];
  const video = { model: "klingai/kling-4.0", input: { type: "text", prompt: "Waves" }, parameters: { duration: 5 } };
  const audio = { model: "minimax/music-2.6", input: { type: "text", prompt: "Folk", lyrics: "[Verse]\nRoad" } };
  const videoClient = createYirClient(gateway(calls, { aspect_ratio: "16:9", resolution: "720p", n: 1, duration: 5 }, "generate_video"), undefined, { demo: true });
  const audioClient = createYirClient(gateway(calls, { n: 1 }, "generate_music"), undefined, { demo: {} });
  assert.match((await videoClient.submitVideo(video)).id, /^demo_1[0-9a-z]{6}v/);
  assert.match((await audioClient.submitAudio(audio)).id, /^demo_1[0-9a-z]{6}m/);
  assert.match((await audioClient.submitMusic(audio)).id, /^demo_1[0-9a-z]{6}m/);
  assert.deepEqual(calls.map(call => call.path), ["/v1/videos/quotes", "/v1/audio/quotes", "/v1/music/quotes"]);
});

test("a rejected demo quote fails the submit with its idempotency key", async () => {
  const invalid = new YirAPIError({ message: "bad", status: 400, code: "YIR_INVALID_REQUEST" });
  const client = createYirClient(async () => { throw invalid; }, undefined, { demo: true });
  const error = await client.submitImage(image, "key-2").catch(error => error);
  assert.equal(error, invalid);
  assert.equal(error.idempotencyKey, "key-2");
  // Local validation still runs first.
  assert.throws(() => client.submitImage({ ...image, input: { type: "text" } }));
});

test("the reject scenario throws 422 YIR_INPUT_REJECTED after the quote; prompt markers win", async () => {
  const calls = [];
  const rejecting = createYirClient(gateway(calls), undefined, { demo: { scenario: "reject" } });
  const error = await rejecting.submitImage(image).catch(error => error);
  assert.ok(error instanceof YirAPIError);
  assert.equal(error.status, 422);
  assert.equal(error.code, "YIR_INPUT_REJECTED");
  assert.equal(typeof error.idempotencyKey, "string");
  assert.equal(calls.length, 1);
  const marked = await rejecting.submitImage({ ...image, input: { type: "text", prompt: "A cup [DEMO:fail]" } });
  assert.match(marked.id, /^demo_1.{12}f/);
  assert.throws(() => createYirClient(gateway([]), undefined, { demo: { scenario: "boom" } }), /demo_scenario_invalid/);
});

test("demo Job reads follow the shared fixture", () => {
  for (const item of fixture.cases) {
    assert.deepEqual(getDemoJob(item.id, item.now_ms), item.job, item.id);
    assert.deepEqual(getDemoJobStatus(item.id, item.now_ms), item.status, item.id);
  }
  const statuses = new Set(fixture.cases.map(item => item.job.status));
  assert.deepEqual([...statuses].sort(), ["cancelled", "failed", "queued", "running", "succeeded"]);
});

test("every client answers demo IDs locally, demo mode or not", async () => {
  const item = fixture.cases.find(item => item.job.status === "succeeded" && item.job.result.files.length === 2);
  const client = createYirClient(async request => { throw new Error(`unexpected ${request.path}`); });
  await at(item.now_ms, async () => {
    assert.deepEqual(await client.getJob(item.id), item.job);
    assert.deepEqual(await client.getJobStatus(item.id, { waitSeconds: 20 }), item.status);
  });
  // Real IDs still go to the Gateway.
  const calls = [];
  const real = createYirClient(async request => { calls.push(request.path); return { id: "job_1", object: "job", status: "queued", error: null }; }, undefined, { demo: true });
  await real.getJob("job_1");
  assert.deepEqual(calls, ["/v1/jobs/job_1"]);
});

test("cancelJob cancels an unfinished demo Job and reports 409 once it ended", async () => {
  const queued = fixture.cases.find(item => item.job.status === "queued");
  const done = fixture.cases.find(item => item.job.status === "succeeded");
  const client = createYirClient(async request => { throw new Error(`unexpected ${request.path}`); });
  await at(queued.now_ms, async () => {
    const job = await client.cancelJob(queued.id);
    assert.equal(job.status, "cancelled");
    assert.equal(job.cancellation.status, "cancelled");
    assert.equal(job.billing.total_charged_by_yir, "0");
    assert.equal(job.result, undefined);
  });
  await at(done.now_ms, async () => {
    const error = await client.cancelJob(done.id).catch(error => error);
    assert.equal(error.status, 409);
    assert.equal(error.code, "YIR_JOB_NOT_CANCELLABLE");
  });
});

test("a long-polled demo status returns at the next change", async () => {
  const client = createYirClient(gateway([]), undefined, { demo: true });
  const job = await client.submitImage(image);
  const started = Date.now();
  const status = await client.getJobStatus(job.id, { waitSeconds: 5 });
  assert.equal(status.status, "running");
  assert.ok(Date.now() - started < 4000);
});

test("createNodeYirClient enables demo mode from YIR_DEMO and waitForJob completes", async () => {
  const paths = [];
  const fetch = async (url, init) => {
    paths.push(new URL(url).pathname);
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify(quoteFor(body, "generate_image", echo.image)), { headers: { "content-type": "application/json" } });
  };
  const previous = process.env.YIR_DEMO;
  const warn = console.warn;
  console.warn = () => {};
  process.env.YIR_DEMO = "1";
  try {
    const client = createNodeYirClient({ apiKey: "sk-test", fetch });
    const job = await client.submitImage(image);
    assert.deepEqual(paths, ["/v1/images/quotes"]);
    const finished = await at(job.created_at * 1000 + 60000, () => client.waitForJob(job.id));
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.result.files.length, 2);
    assert.match(finished.result.files[0].url, /^https:\/\/public\.yir\.ai\/demo\/v1\/image\/16x9-1\.jpg$/);
    assert.deepEqual([finished.result.files[0].width, finished.result.files[0].height], [1280, 720]);
    // An explicit option wins over the environment.
    const live = createNodeYirClient({ apiKey: "sk-test", demo: false, fetch: async url => {
      paths.push(new URL(url).pathname);
      return new Response(JSON.stringify({ id: "job_9", object: "job", status: "queued", model: "m", error: null, created_at: 1 }), { headers: { "content-type": "application/json" } });
    } });
    await live.submitImage(image);
    assert.equal(paths.at(-1), "/v1/images/generations");
  } finally {
    if (previous === undefined) delete process.env.YIR_DEMO; else process.env.YIR_DEMO = previous;
    console.warn = warn;
  }
});

test("demo IDs fit the Job ID limit for the longest model and reject longer ones", async () => {
  const longest = "spacexai/grok-imagine-video-1.5-lite";
  const client = createYirClient(async request => ({ ...quoteFor(request.body, "generate_video", { aspect_ratio: "16:9", resolution: "720p", n: 1, duration: 5 }), model: request.body.model }), undefined, { demo: true });
  const video = { model: longest, input: { type: "text", prompt: "Waves" }, parameters: {} };
  const job = await client.submitVideo(video);
  assert.ok(job.id.length <= 64 && isValidJobID(job.id));
  assert.equal(getDemoJob(job.id).model, longest);
  const error = await client.submitVideo({ ...video, model: "vendor/a-model-name-that-is-far-too-long-for-ids" }).catch(error => error);
  assert.equal(error.message, "demo_model_id_too_long");
});

test("the SDK asset table matches the published manifest", () => {
  assert.equal(manifest.base_url, "https://public.yir.ai/demo/v1/");
  assert.deepEqual(DEMO_ASSETS, manifest.assets.map(({ sha256: _, ...asset }) => asset));
});

test("the Vercel adapter refuses a demo flag next to an injected client", async () => {
  const { createYirAIProvider } = await import("../dist/server/vercel.js");
  const client = createYirClient(async request => { throw new Error(`unexpected ${request.path}`); });
  assert.throws(() => createYirAIProvider({ client, demo: true }), /demo_requires_client_option/);
  assert.doesNotThrow(() => createYirAIProvider({ client: createYirClient(gateway([]), undefined, { demo: true }) }));
});

test("demo video results report the sample's measured length", () => {
  const item = fixture.cases.find(item => item.job.status === "succeeded" && item.job.result.files[0].media_type === "video/mp4");
  assert.equal(item.job.result.files[0].duration_ms, 10000);
});
