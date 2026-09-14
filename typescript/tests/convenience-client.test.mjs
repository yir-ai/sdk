import assert from "node:assert/strict";
import test from "node:test";
import {
  createNodeHttpTransport,
  createNodeYirClient,
  createYirClient,
  DEFAULT_GATEWAY_BASE_URL,
  DEFAULT_USER_AGENT,
  isTerminalJobStatus,
  TERMINAL_JOB_STATUSES,
  waitForJob,
  YirAPIError,
  YirJobError,
  YirTimeoutError,
} from "../dist/index.js";

test("status helpers correctly classify terminal vs non-terminal job statuses", () => {
  assert.deepEqual([...TERMINAL_JOB_STATUSES], ["succeeded", "failed", "cancelled"]);
  assert.equal(isTerminalJobStatus("queued"), false);
  assert.equal(isTerminalJobStatus("running"), false);
  assert.equal(isTerminalJobStatus("delivering"), false);
  assert.equal(isTerminalJobStatus("succeeded"), true);
  assert.equal(isTerminalJobStatus("failed"), true);
  assert.equal(isTerminalJobStatus("cancelled"), true);
});

test("createNodeHttpTransport requires an API key", () => {
  const originalEnv = process.env.YIR_API_KEY;
  delete process.env.YIR_API_KEY;
  try {
    assert.throws(
      () => createNodeHttpTransport(),
      /api_key_required/,
    );
    assert.throws(
      () => createNodeHttpTransport({ apiKey: "   " }),
      /api_key_required/,
    );
  } finally {
    if (originalEnv !== undefined) {
      process.env.YIR_API_KEY = originalEnv;
    }
  }
});

test("createNodeHttpTransport injects Authorization, User-Agent, and standard headers", async () => {
  const recorded = [];
  const mockFetch = async (url, init) => {
    recorded.push({ url, init });
    return new Response(JSON.stringify({ id: "1001", object: "job", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const transport = createNodeHttpTransport({
    apiKey: "yir_test_secret_key",
    fetch: mockFetch,
    headers: { "X-Custom-Global": "hello" },
  });

  const response = await transport({
    method: "POST",
    path: "/v1/images/generations",
    headers: { "Idempotency-Key": "idemp_1001" },
    body: { prompt: "test prompt" },
  });

  assert.deepEqual(response, { id: "1001", object: "job", status: "queued" });
  assert.equal(recorded.length, 1);
  const req = recorded[0];
  assert.equal(req.url, `${DEFAULT_GATEWAY_BASE_URL}/v1/images/generations`);
  assert.equal(req.init.method, "POST");
  assert.equal(req.init.redirect, "error");
  assert.equal(req.init.headers["Authorization"], "Bearer yir_test_secret_key");
  assert.equal(req.init.headers["User-Agent"], DEFAULT_USER_AGENT);
  assert.equal(req.init.headers["Content-Type"], "application/json");
  assert.equal(req.init.headers["Idempotency-Key"], "idemp_1001");
  assert.equal(req.init.headers["X-Custom-Global"], "hello");
  assert.equal(req.init.body, JSON.stringify({ prompt: "test prompt" }));
});

test("createNodeHttpTransport supports custom baseURL and custom userAgent", async () => {
  const recorded = [];
  const mockFetch = async (url, init) => {
    recorded.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const transport = createNodeHttpTransport({
    apiKey: "yir_test_secret_key",
    baseURL: "https://custom.gateway.internal///",
    userAgent: "custom-agent/2.0",
    fetch: mockFetch,
  });

  await transport({
    method: "GET",
    path: "/v1/jobs/1001",
  });

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].url, "https://custom.gateway.internal/v1/jobs/1001");
  assert.equal(recorded[0].init.headers["User-Agent"], "custom-agent/2.0");
  assert.equal("Content-Type" in recorded[0].init.headers, false);
});

test("createNodeHttpTransport maps Standard API error responses to YirAPIError", async () => {
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "YIR_INSUFFICIENT_BALANCE",
          message: "Account balance is insufficient.",
          retryable: false,
          action: "add_funds",
        },
        request_id: "req_balance_999",
      }),
      {
        status: 402,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const transport = createNodeHttpTransport({
    apiKey: "yir_test_key",
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => {
      await transport({ method: "POST", path: "/v1/images/generations", body: {} });
    },
    (error) => {
      assert.ok(error instanceof YirAPIError);
      assert.equal(error.status, 402);
      assert.equal(error.code, "YIR_INSUFFICIENT_BALANCE");
      assert.equal(error.message, "Account balance is insufficient.");
      assert.equal(error.retryable, false);
      assert.equal(error.action, "add_funds");
      assert.equal(error.requestId, "req_balance_999");
      return true;
    },
  );
});

test("createNodeHttpTransport handles plain text error responses as YirAPIError", async () => {
  const mockFetch = async () => {
    return new Response("Bad Gateway upstream unreachable", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  };

  const transport = createNodeHttpTransport({
    apiKey: "yir_test_key",
    fetch: mockFetch,
  });

  await assert.rejects(
    async () => {
      await transport({ method: "GET", path: "/v1/jobs/1001" });
    },
    (error) => {
      assert.ok(error instanceof YirAPIError);
      assert.equal(error.status, 502);
      assert.equal(error.code, "HTTP_502");
      assert.equal(error.message, "Bad Gateway upstream unreachable");
      return true;
    },
  );
});

test("waitForJob validates inputs", async () => {
  const dummyClient = { getJob: async () => ({}) };

  await assert.rejects(
    () => waitForJob(dummyClient, "invalid-job-id"),
    /job_id_invalid/,
  );
  await assert.rejects(
    () => waitForJob(dummyClient, "1001", { pollIntervalMs: 0 }),
    /poll_interval_invalid/,
  );
  await assert.rejects(
    () => waitForJob(dummyClient, "1001", { pollIntervalMs: -50 }),
    /poll_interval_invalid/,
  );
});

test("waitForJob returns immediately if job is already succeeded", async () => {
  const polled = [];
  const succeededJob = {
    id: "2001",
    object: "job",
    status: "succeeded",
    model: "openai/gpt-image-2",
    result: {
      availability: "available",
      files: [{ url: "https://r2.yir.ai/img.png", media_type: "image/png", expires_at: 1786000000 }],
    },
    error: null,
    created_at: 1785974400,
    completed_at: 1785974410,
  };

  const client = {
    getJob: async (id) => {
      polled.push(id);
      return succeededJob;
    },
  };

  const result = await waitForJob(client, "2001", {
    onPoll: (job) => {
      assert.equal(job.id, "2001");
    },
  });

  assert.equal(polled.length, 1);
  assert.deepEqual(result, succeededJob);
});

test("waitForJob polls sequentially until succeeded", async () => {
  const states = ["queued", "running", "delivering", "succeeded"];
  const onPollHistory = [];
  let callCount = 0;

  const client = {
    getJob: async (id) => {
      const status = states[Math.min(callCount, states.length - 1)];
      callCount += 1;
      return {
        id,
        object: "job",
        status,
        model: "openai/gpt-image-2",
        error: null,
        created_at: 1785974400,
        completed_at: status === "succeeded" ? 1785974415 : undefined,
      };
    },
  };

  const result = await waitForJob(client, "3001", {
    pollIntervalMs: 10,
    onPoll: (job) => {
      onPollHistory.push(job.status);
    },
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(onPollHistory, ["queued", "running", "delivering", "succeeded"]);
  assert.equal(callCount, 4);
});

test("waitForJob throws YirJobError on failure by default", async () => {
  const failedJob = {
    id: "4001",
    object: "job",
    status: "failed",
    model: "openai/gpt-image-2",
    error: {
      code: "YIR_EXECUTION_FAILED",
      message: "Rendering node timed out.",
      retryable: true,
      action: "retry_later",
    },
    created_at: 1785974400,
    completed_at: 1785974420,
  };

  const client = {
    getJob: async () => failedJob,
  };

  await assert.rejects(
    () => waitForJob(client, "4001", { pollIntervalMs: 10 }),
    (error) => {
      assert.ok(error instanceof YirJobError);
      assert.equal(error.code, "YIR_EXECUTION_FAILED");
      assert.equal(error.retryable, true);
      assert.equal(error.action, "retry_later");
      assert.deepEqual(error.job, failedJob);
      assert.match(error.message, /Rendering node timed out/);
      return true;
    },
  );
});

test("waitForJob returns terminal job on failure when throwOnFailure is false", async () => {
  const failedJob = {
    id: "4002",
    object: "job",
    status: "failed",
    model: "openai/gpt-image-2",
    error: {
      code: "YIR_EXECUTION_FAILED",
      message: "Unrecoverable hardware error.",
      retryable: false,
    },
    created_at: 1785974400,
    completed_at: 1785974420,
  };

  const client = {
    getJob: async () => failedJob,
  };

  const result = await waitForJob(client, "4002", {
    pollIntervalMs: 10,
    throwOnFailure: false,
  });

  assert.deepEqual(result, failedJob);
});

test("waitForJob handles cancelled jobs properly", async () => {
  const cancelledJob = {
    id: "4003",
    object: "job",
    status: "cancelled",
    model: "openai/gpt-image-2",
    error: null,
    created_at: 1785974400,
    completed_at: 1785974405,
  };

  const client = {
    getJob: async () => cancelledJob,
  };

  await assert.rejects(
    () => waitForJob(client, "4003", { pollIntervalMs: 10 }),
    (error) => {
      assert.ok(error instanceof YirJobError);
      assert.equal(error.code, "YIR_JOB_CANCELLED");
      assert.deepEqual(error.job, cancelledJob);
      return true;
    },
  );

  const directResult = await waitForJob(client, "4003", {
    pollIntervalMs: 10,
    throwOnFailure: false,
  });
  assert.equal(directResult.status, "cancelled");
});

test("waitForJob throws YirTimeoutError when timeout expires", async () => {
  const runningJob = {
    id: "5001",
    object: "job",
    status: "running",
    model: "openai/gpt-image-2",
    error: null,
    created_at: 1785974400,
  };

  const client = {
    getJob: async () => runningJob,
  };

  await assert.rejects(
    () => waitForJob(client, "5001", { pollIntervalMs: 30, timeoutMs: 50 }),
    (error) => {
      assert.ok(error instanceof YirTimeoutError);
      assert.equal(error.jobId, "5001");
      assert.equal(error.timeoutMs, 50);
      assert.deepEqual(error.lastJob, runningJob);
      return true;
    },
  );
});

test("waitForJob aborts an in-flight getJob request when timeout expires", async () => {
  let requestSignal;
  const client = {
    getJob: async (_id, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    },
  };

  await assert.rejects(
    () => waitForJob(client, "5002", { timeoutMs: 20 }),
    (error) => error instanceof YirTimeoutError && error.jobId === "5002",
  );
  assert.equal(requestSignal.aborted, true);
});

test("waitForJob respects AbortSignal", async () => {
  const client = {
    getJob: async () => ({
      id: "6001",
      object: "job",
      status: "running",
      model: "openai/gpt-image-2",
      error: null,
      created_at: 1785974400,
    }),
  };

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  await assert.rejects(
    () => waitForJob(client, "6001", { pollIntervalMs: 50, signal: controller.signal }),
    /aborted|AbortError/,
  );
});

test("createNodeYirClient provides client.waitForJob convenience method", async () => {
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        id: "7001",
        object: "job",
        status: "succeeded",
        model: "openai/gpt-image-2",
        error: null,
        created_at: 1785974400,
        completed_at: 1785974405,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const client = createNodeYirClient({
    apiKey: "yir_mock_key",
    fetch: mockFetch,
  });

  const job = await client.waitForJob("7001", { pollIntervalMs: 10 });
  assert.equal(job.id, "7001");
  assert.equal(job.status, "succeeded");
});
