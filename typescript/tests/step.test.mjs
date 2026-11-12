import test from "node:test";
import assert from "node:assert/strict";
import {
  createNodeYirClient, createYirClient, isSubmissionNotAccepted, pollJob, usdMicros,
  YirAPIError, YirSDKValidationError, YirSubmissionUncertainError,
} from "../dist/index.js";

const api = (status, code) => new YirAPIError({ message: "fixture", status, code });
const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "one image" }, parameters: { resolution: "1K" } };

test("isSubmissionNotAccepted is true only for rejections that created no Job", () => {
  for (const [name, error, want] of [
    ["local validation", new YirSDKValidationError("model_required", "model"), true],
    ["insufficient balance", api(402, "YIR_INSUFFICIENT_BALANCE"), true],
    ["invalid request", api(400, "YIR_INVALID_REQUEST"), true],
    ["no route", api(422, "YIR_NO_EXECUTABLE_ROUTE"), true],
    ["rate limited", api(429, "YIR_RATE_LIMITED"), true],
    ["file not ready", api(409, "YIR_FILE_NOT_READY"), true],
    ["idempotency conflict", api(409, "YIR_IDEMPOTENCY_CONFLICT"), false],
    ["job not found after create", api(404, "YIR_JOB_NOT_FOUND"), false],
    ["request timeout", api(408, "YIR_TEMPORARILY_UNAVAILABLE"), false],
    ["unavailable", api(503, "YIR_TEMPORARILY_UNAVAILABLE"), false],
    ["edge response without a Yir code", api(429), false],
    ["unreadable accepted response", new Error("response_invalid"), false],
    ["uncertain", new YirSubmissionUncertainError("key", api(429, "YIR_RATE_LIMITED")), false],
    ["not an error", undefined, false],
  ]) {
    assert.equal(isSubmissionNotAccepted(error), want, name);
  }
});

test("a rejected submit is not accepted and keeps its idempotency key", async () => {
  const client = createYirClient(async () => { throw api(402, "YIR_INSUFFICIENT_BALANCE"); });
  const error = await client.submitImage(request, "saved-key").catch(error => error);
  assert.equal(isSubmissionNotAccepted(error), true);
  assert.equal(error.idempotencyKey, "saved-key");
});

test("a rejection the SDK had to wrap is still recognized as not accepted", async () => {
  const frozen = Object.freeze(api(402, "YIR_INSUFFICIENT_BALANCE"));
  const client = createYirClient(async () => { throw frozen; });
  const error = await client.submitImage(request, "saved-key").catch(error => error);
  assert.equal(error.message, "job_submit_failed");
  assert.equal(isSubmissionNotAccepted(error), true);
});

test("an abort reason that reads like a rejection is uncertain, not a rejection", async () => {
  for (const reason of [api(402, "YIR_INSUFFICIENT_BALANCE"), new YirSDKValidationError("model_required", "model")]) {
    const controller = new AbortController();
    // The request was sent, then another operation's failure aborted it.
    const client = createYirClient(async ({ signal }) => { controller.abort(reason); throw signal.reason; });
    const error = await client.submitImage(request, "saved-key", { signal: controller.signal }).catch(error => error);
    assert.ok(error instanceof YirSubmissionUncertainError);
    assert.equal(error.idempotencyKey, "saved-key");
    assert.equal(isSubmissionNotAccepted(error), false);
  }
});

test("an API error thrown by the fetch adapter is uncertain, not a Gateway rejection", async () => {
  // A fetch adapter that merges its own cancellation can reject with another operation's error.
  for (const thrown of [api(402, "YIR_INSUFFICIENT_BALANCE"), Object.freeze(api(402, "YIR_INSUFFICIENT_BALANCE")), new YirSDKValidationError("model_required", "model")]) {
    const client = createNodeYirClient({ apiKey: "fixture", fetch: async () => { throw thrown; } });
    const error = await client.submitImage(request, "saved-key").catch(error => error);
    assert.ok(error instanceof YirSubmissionUncertainError);
    assert.equal(isSubmissionNotAccepted(error), false);
  }
  const rejected = createNodeYirClient({ apiKey: "fixture", fetch: async () => Response.json(
    { error: { code: "YIR_INSUFFICIENT_BALANCE", message: "fixture", retryable: false }, request_id: "r1" }, { status: 402 }) });
  assert.equal(isSubmissionNotAccepted(await rejected.submitImage(request, "saved-key").catch(error => error)), true);
});

test("cancelJob returns a Job that already ended instead of the 409", async () => {
  const calls = [];
  const client = createYirClient(async ({ method, path }) => {
    calls.push(`${method} ${path}`);
    if (method === "POST") throw api(409, "YIR_JOB_NOT_CANCELLABLE");
    return { id: "101", status: "succeeded" };
  });
  assert.equal((await client.cancelJob("101")).status, "succeeded");
  assert.deepEqual(calls, ["POST /v1/jobs/101/cancel", "GET /v1/jobs/101"]);
  const other = createYirClient(async () => { throw api(409, "YIR_FILE_NOT_READY"); });
  await assert.rejects(other.cancelJob("101"), { code: "YIR_FILE_NOT_READY" });
});

test("pollJob reads the full Job only once the status is terminal", async () => {
  const client = (status, detail, calls = []) => [calls, createYirClient(async ({ path }) => {
    calls.push(path);
    return path.endsWith("/status") ? { id: "101", status, error: null } : { id: "101", status: detail };
  })];
  const [running, runningClient] = client("running", "running");
  assert.deepEqual(await pollJob(runningClient, "101"), { done: false, status: { id: "101", status: "running", error: null } });
  assert.deepEqual(running, ["/v1/jobs/101/status"]);

  const [failed, failedClient] = client("failed", "failed");
  assert.deepEqual(await pollJob(failedClient, "101", { waitSeconds: 5 }), { done: true, job: { id: "101", status: "failed" } });
  assert.deepEqual(failed, ["/v1/jobs/101/status?wait=5", "/v1/jobs/101"]);

  const [, inconsistentClient] = client("succeeded", "running");
  await assert.rejects(pollJob(inconsistentClient, "101"), /job_state_inconsistent/);
});

test("usdMicros converts API amounts without rounding", () => {
  for (const [amount, want] of [["0", 0n], ["0.0325", 32500n], ["12", 12000000n], ["1.000001", 1000001n]]) {
    assert.equal(usdMicros(amount), want);
  }
  for (const amount of ["", "-1", "1.", ".5", "1e3", "0.0000001", 5]) {
    assert.throws(() => usdMicros(amount), /amount_invalid/);
  }
});

// Another submit's failure, wrapped by the SDK as job_submit_failed around a 402,
// reaching this submit as an abort reason or adapter error.
const wrappedRejection = () => {
  const wrapped = new Error("job_submit_failed", { cause: Object.freeze(api(402, "YIR_INSUFFICIENT_BALANCE")) });
  Object.defineProperty(wrapped, "idempotencyKey", { value: "key-A", configurable: true });
  return wrapped;
};

test("a 202 whose body read throws a plain Error is uncertain", async () => {
  const client = createNodeYirClient({ apiKey: "fixture", fetch: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"id":"job-1",'));
    controller.error(new Error("stream reset"));
  } }), { status: 202, headers: { "Content-Type": "application/json" } }) });
  const error = await client.submitImage(request, "saved-key").catch(error => error);
  assert.ok(error instanceof YirSubmissionUncertainError);
  assert.equal(error.idempotencyKey, "saved-key");
  assert.equal(isSubmissionNotAccepted(error), false);
});

test("a wrapped rejection used as the abort reason of a sent submit is not a rejection", async () => {
  const controller = new AbortController();
  const node = createNodeYirClient({ apiKey: "fixture", fetch: (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
    controller.abort(wrappedRejection());
  }) });
  const controller2 = new AbortController();
  const custom = createYirClient(async ({ signal }) => { controller2.abort(wrappedRejection()); throw signal.reason; });
  for (const [client, signal] of [[node, controller.signal], [custom, controller2.signal]]) {
    const error = await client.submitImage(request, "key-B", { signal }).catch(error => error);
    assert.ok(error instanceof YirSubmissionUncertainError);
    assert.equal(error.idempotencyKey, "key-B");
    assert.equal(isSubmissionNotAccepted(error), false);
  }
  // The same wrapper re-wrapped for another key does not pass as this call's rejection.
  const rewrapped = new Error("job_submit_failed", { cause: wrappedRejection() });
  Object.defineProperty(rewrapped, "idempotencyKey", { value: "key-B" });
  assert.equal(isSubmissionNotAccepted(rewrapped), false);
  const keyedElsewhere = new Error("job_submit_failed", { cause: Object.defineProperty(api(402, "YIR_INSUFFICIENT_BALANCE"), "idempotencyKey", { value: "key-A" }) });
  Object.defineProperty(keyedElsewhere, "idempotencyKey", { value: "key-B" });
  assert.equal(isSubmissionNotAccepted(keyedElsewhere), false);
});

test("another submit's uncertain error aborting this submit returns this submit's key", async () => {
  const other = new YirSubmissionUncertainError("key-A", api(429, "YIR_RATE_LIMITED"));
  const controller = new AbortController();
  const node = createNodeYirClient({ apiKey: "fixture", fetch: (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
    controller.abort(other);
  }) });
  const controller2 = new AbortController();
  const custom = createYirClient(async ({ signal }) => { controller2.abort(other); throw signal.reason; });
  for (const [client, signal] of [[node, controller.signal], [custom, controller2.signal]]) {
    const error = await client.submitImage(request, "key-B", { signal }).catch(error => error);
    assert.ok(error instanceof YirSubmissionUncertainError);
    assert.equal(error.idempotencyKey, "key-B");
    assert.equal(isSubmissionNotAccepted(error), false);
  }
  // The submit's own uncertain error is returned as is.
  const own = createYirClient(async () => { throw new YirSubmissionUncertainError("key-B", api(429, "YIR_RATE_LIMITED")); });
  const error = await own.submitImage(request, "key-B").catch(error => error);
  assert.equal(error.idempotencyKey, "key-B");
  assert.ok(error.cause instanceof YirAPIError);
});
