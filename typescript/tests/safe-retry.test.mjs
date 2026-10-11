import test from "node:test";
import assert from "node:assert/strict";
import { createNodeHttpTransport } from "../dist/index.js";

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
