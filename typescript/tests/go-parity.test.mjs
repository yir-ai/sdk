import assert from "node:assert/strict";
import test from "node:test";
import { createNodeHttpTransport, createYirClient, DEFAULT_REQUEST_TIMEOUT_MS, YirAPIError } from "../dist/index.js";

// These behaviours match the Go SDK so one upstream change lands the same way in both.

test("the Node transport limits each request to 30 seconds by default", async () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 30000);
  let seen;
  const fetch = async (_url, init) => { seen = init.signal; return Response.json({ id: "1", status: "queued" }); };
  await createNodeHttpTransport({ apiKey: "k", fetch })({ method: "GET", path: "/v1/jobs/1" });
  assert.ok(seen instanceof AbortSignal, "default timeout signal");
  await createNodeHttpTransport({ apiKey: "k", fetch, timeoutMs: 0 })({ method: "GET", path: "/v1/jobs/1" });
  assert.equal(seen, undefined, "0 disables the timeout");
  const caller = new AbortController();
  await createNodeHttpTransport({ apiKey: "k", fetch, timeoutMs: Infinity })({ method: "GET", path: "/v1/jobs/1", signal: caller.signal });
  assert.equal(seen, caller.signal, "Infinity keeps only the caller signal");
  for (const timeoutMs of [-1, 1.5, NaN, 2 ** 31]) {
    assert.throws(() => createNodeHttpTransport({ apiKey: "k", fetch, timeoutMs }), /timeout_invalid/);
  }
});

test("a slow Gateway response times out", async () => {
  const fetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  await assert.rejects(createNodeHttpTransport({ apiKey: "k", fetch, timeoutMs: 20 })({ method: "GET", path: "/v1/jobs/1" }),
    error => error.name === "TimeoutError");
});

test("error bodies without a code fall back to http_error and keep the request ID", async () => {
  for (const [body, type] of [[JSON.stringify({ request_id: "req_1" }), "application/json"],
    [JSON.stringify({ error: { message: "m" }, request_id: "req_1" }), "application/json"]]) {
    const fetch = async () => new Response(body, { status: 503, headers: { "Content-Type": type } });
    await assert.rejects(createNodeHttpTransport({ apiKey: "k", fetch })({ method: "GET", path: "/v1/jobs/1" }),
      error => error instanceof YirAPIError && error.code === "http_error" && error.status === 503 && error.requestId === "req_1");
  }
  assert.equal(new YirAPIError({ message: "m", status: 500 }).code, "http_error");
});

test("submit rejects a response that is not a created Job", async () => {
  const request = { model: "future/image", input: { type: "text", prompt: "x" }, parameters: {} };
  for (const response of [null, {}, { id: "abc", status: "queued" }, { id: "1", status: "" }]) {
    const client = createYirClient(async () => response);
    await assert.rejects(client.submitImage(request, "key"), /response_invalid/);
    await assert.rejects(client.submitVideo(request, "key"), /response_invalid/);
  }
  const job = await createYirClient(async () => ({ id: "1", status: "queued" })).submitImage(request, "key");
  assert.equal(job.id, "1");
});

test("error actions newer than the SDK pass through", async () => {
  const fetch = async () => Response.json({ error: { code: "YIR_NEW", message: "m", retryable: false, action: "verify_identity" } }, { status: 403 });
  await assert.rejects(createNodeHttpTransport({ apiKey: "k", fetch })({ method: "GET", path: "/v1/jobs/1" }),
    error => error instanceof YirAPIError && error.action === "verify_identity");
});
