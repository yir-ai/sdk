import test from "node:test";
import assert from "node:assert/strict";
import { createNodeHttpTransport, createNodeYirClient, YirAPIError, YirSubmissionUncertainError } from "../dist/index.js";

test("lost submit response retries the identical body and idempotency key", async () => {
  const seen = [];
  const jobs = new Map();
  const transport = createNodeHttpTransport({ apiKey: "fixture", fetch: async (_, init) => {
    const key = new Headers(init.headers).get("Idempotency-Key");
    seen.push([key, init.body]);
    if (!jobs.has(key)) jobs.set(key, { id: "job-1", status: "queued" });
    if (seen.length === 1) throw new TypeError("fetch failed");
    return Response.json(jobs.get(key));
  }});
  assert.equal((await transport({ method: "POST", path: "/v1/videos/generations", body: { model: "fixture" }, headers: { "Idempotency-Key": "stable" } })).id, "job-1");
  assert.equal(jobs.size, 1);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1]);
});

test("gateway restart recovers reads with a bounded retry budget", async () => {
  let calls = 0;
  const transport = createNodeHttpTransport({ apiKey: "fixture", fetch: async () => {
    calls++;
    return calls < 3 ? new Response("gateway unavailable", { status: 502 }) : Response.json({ status: "succeeded" });
  }});
  assert.equal((await transport({ method: "GET", path: "/v1/jobs/job-1" })).status, "succeeded");
  assert.equal(calls, 3);
});

test("unsafe writes and explicit rejections are never replayed", async () => {
  for (const [method, path, headers, status] of [
    ["POST", "/v1/videos/generations", {}, 502],
    ["POST", "/v1/jobs/job-1/cancel", { "Idempotency-Key": "stable" }, 502],
    ["POST", "/v1/videos/generations", { "Idempotency-Key": "stable" }, 400],
    ["GET", "/v1/jobs/job-1", {}, 401],
  ]) {
    let calls = 0;
    const transport = createNodeHttpTransport({ apiKey: "fixture", fetch: async () => { calls++; return new Response("rejected", { status }); }});
    await assert.rejects(transport({ method, path, headers }));
    assert.equal(calls, 1);
  }
});

test("abort during backoff stops retries", async () => {
  let calls = 0;
  const controller = new AbortController();
  const transport = createNodeHttpTransport({ apiKey: "fixture", fetch: async () => {
    calls++;
    setTimeout(() => controller.abort(), 20);
    return new Response("unavailable", { status: 503 });
  }});
  await assert.rejects(transport({ method: "GET", path: "/v1/jobs/job-1", signal: controller.signal }));
  assert.equal(calls, 1);
});

// After an attempt with an unknown outcome, the replay may be rejected by
// admission checks that run before idempotent replay while the first attempt's
// Job runs and is billed; the rejection must not read as "not accepted".
test("submit failing after an unknown outcome is uncertain and keeps the key", async () => {
  const rejection = (status, code) => () => Response.json({ error: { code, message: "fixture" } }, { status });
  const dropped = () => { throw new TypeError("fetch failed"); };
  const cutAcceptedBody = () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"id":"job-1",'));
    controller.error(new TypeError("terminated"));
  } }), { status: 202, headers: { "Content-Type": "application/json" } });
  const unavailable = rejection(503, "YIR_TEMPORARILY_UNAVAILABLE");
  const accepted = () => Response.json({ id: "job-1", status: "queued" }, { status: 202 });
  const cases = [
    ["lost response then rate limited", [dropped, rejection(429, "YIR_RATE_LIMITED")], 429, "YIR_RATE_LIMITED"],
    ["accepted body cut off then rate limited", [cutAcceptedBody, rejection(429, "YIR_RATE_LIMITED")], 429, "YIR_RATE_LIMITED"],
    ["unavailable then insufficient balance", [unavailable, rejection(402, "YIR_INSUFFICIENT_BALANCE")], 402, "YIR_INSUFFICIENT_BALANCE"],
    ["unavailable on every attempt", [unavailable, unavailable, unavailable, unavailable], 503, "YIR_TEMPORARILY_UNAVAILABLE"],
    ["lost response then accepted", [dropped, accepted]],
  ];
  await Promise.all(cases.map(async ([name, responses, status, code]) => {
    const keys = [];
    const client = createNodeYirClient({ apiKey: "fixture", fetch: async (_, init) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key"));
      return responses[Math.min(keys.length, responses.length) - 1]();
    }});
    const submit = client.submitImage({ model: "openai/gpt-image-2", input: { type: "text", prompt: "fixture" }, parameters: {} }, "persisted-key");
    if (status === undefined) {
      assert.equal((await submit).id, "job-1", name);
    } else {
      await assert.rejects(submit, error => {
        assert.ok(error instanceof YirSubmissionUncertainError, name);
        assert.equal(error.idempotencyKey, "persisted-key", name);
        assert.ok(error.cause instanceof YirAPIError, name);
        assert.equal(error.cause.status, status, name);
        assert.equal(error.cause.code, code, name);
        assert.equal(JSON.stringify(error).includes("persisted-key"), false, name);
        return true;
      });
    }
    assert.equal(keys.length, responses.length, name);
    assert.ok(keys.every(key => key === "persisted-key"), name);
  }));
});

test("explicit submit rejections and read failures are not uncertain", async () => {
  const client = createNodeYirClient({ apiKey: "fixture", fetch: async () =>
    Response.json({ error: { code: "YIR_RATE_LIMITED", message: "fixture" } }, { status: 429 }) });
  await assert.rejects(client.submitImage({ model: "openai/gpt-image-2", input: { type: "text", prompt: "fixture" }, parameters: {} }, "persisted-key"),
    error => error instanceof YirAPIError && error.idempotencyKey === "persisted-key");
  let calls = 0;
  const transport = createNodeHttpTransport({ apiKey: "fixture", fetch: async () => { calls++; return new Response("unavailable", { status: 503 }); } });
  await assert.rejects(transport({ method: "GET", path: "/v1/jobs/job-1" }), error => error instanceof YirAPIError && error.status === 503);
  assert.equal(calls, 4);
});
