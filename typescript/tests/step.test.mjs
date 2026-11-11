import test from "node:test";
import assert from "node:assert/strict";
import {
  createYirClient, isSubmissionNotAccepted, pollJob, usdMicros,
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
