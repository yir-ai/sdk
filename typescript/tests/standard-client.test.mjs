import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { quoteFixture } from "./quote-fixture.mjs";
import * as YirSDK from "../dist/index.js";

import {
  buildImageGenerationRequest,
  buildImageQuoteRequest,
  createYirClient,
  normalizeRoutingOverride,
  waitForJob,
  YirJobError,
  YirSDKValidationError,
  YirTimeoutError,
} from "../dist/index.js";

test("public SDK surface exposes generated static contracts without the removed runtime registry", () => {
  assert.equal(typeof YirSDK.listModelContracts, "function");
  assert.equal(typeof YirSDK.getModelContract, "function");
  assert.equal(typeof YirSDK.getModelOperationContract, "function");
  for (const removedExport of [
    "Models",
    "Operations",
    "InputModes",
    "BytedanceSeedance20GenerateVideo",
    "BytedanceSeedance20GenerateVideoContract",
    "OpenaiGptImage2GenerateImage",
    "OpenaiGptImage2GenerateImageContract",
    "ParameterContractRegistry",
    "getParameterContract",
    "getContractCapability",
    "listContractCapabilities",
    "resolveParameters",
    "validateParameters",
  ]) {
    assert.equal(removedExport in YirSDK, false, removedExport);
  }
});

test("SDK build removes stale model-contract artifacts", async () => {
  await access(new URL("../dist/shared/generated/model-contracts.generated.js", import.meta.url));
  for (const removedArtifact of [
    "../dist/runtime.js",
    "../dist/generated/contracts.js",
  ]) {
    await assert.rejects(
      access(new URL(removedArtifact, import.meta.url)),
      (error) => error?.code === "ENOENT",
      removedArtifact,
    );
  }
});

test("SDK consumes the shared GPT Image 2 Standard contract fixture", async () => {
  const fixture = JSON.parse(await readFile(
    new URL(
      "../../spec/fixtures/standard-contracts/gpt-image-2.generate-image.text.1k-square.v1.json",
      import.meta.url,
    ),
    "utf8",
  ));
  const { webhookUrl: _webhookURL, ...quoteInput } = fixture.builderInput;

  assert.deepEqual(
    buildImageGenerationRequest(fixture.builderInput),
    fixture.generationRequest,
  );
  assert.deepEqual(buildImageQuoteRequest(quoteInput), fixture.quoteRequest);
});

test("Standard request builder preserves parameters validated against the bundled contract", () => {
  const request = buildImageGenerationRequest({
    model: "openai/gpt-image-2",
    prompt: "  A quiet observatory above a sea of clouds  ",
    parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
    routing: { only: ["kie", "apimart"], fallback: false },
  });

  assert.deepEqual(request, {
    model: "openai/gpt-image-2",
    input: { type: "text", prompt: "A quiet observatory above a sea of clouds" },
    parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
    routing: { only: ["apimart", "kie"], fallback: false },
  });
});

test("Standard image request requires exactly one output", () => {
  for (const n of [0, 1.5, 2, 10]) {
    assert.throws(
      () => buildImageGenerationRequest({
        model: "openai/gpt-image-2",
        prompt: "Generate a batch",
        parameters: { resolution: "1K", aspect_ratio: "1:1", n },
      }),
      (error) => error instanceof YirSDKValidationError
        && ["parameter_value", "parameter_type"].includes(error.code)
        && error.path === "parameters.n",
    );
  }
});

test("image Quote and Submit preserve the same URL or File ID source", () => {
  for (const image of [
    { url: "https://example.com/reference.png" },
    { file_id: "file_11111111-1111-4111-8111-111111111111" },
  ]) {
    const input = {
      model: "openai/gpt-image-2", prompt: "Edit this image", image,
      parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
    };
    const quote = buildImageQuoteRequest(input);
    const submit = buildImageGenerationRequest({ ...input, maxCost: "0.25" });
    assert.deepEqual(quote.input, { type: "image", prompt: input.prompt, references: [{ role: "reference_image", ...image }] });
    assert.deepEqual(submit, { ...quote, max_cost: "0.25" });
  }
});

test("image builders reject ambiguous or empty source representations", () => {
  for (const image of [null, [], {}, { url: "" }, { file_id: "" },
    { url: "https://example.com/a.png", file_id: "file_1" },
    { url: "https://example.com/a.png", extra: true }]) {
    assert.throws(() => buildImageGenerationRequest({
      model: "openai/gpt-image-2", prompt: "Edit", image,
      parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
    }), error => error instanceof YirSDKValidationError && error.path === "input.image");
  }
});

test("Standard request builder does not synthesize model defaults", () => {
  assert.throws(
    () => buildImageGenerationRequest({
      model: "openai/gpt-image-2",
      prompt: "test",
    }),
    (error) => error instanceof YirSDKValidationError
      && error.code === "parameters_required",
  );
});

test("SDK follows the shared RoutingOverride v1 contract", async () => {
  const fixture = JSON.parse(await readFile(
    new URL(
      "../../spec/fixtures/standard-contracts/routing-override.v1.json",
      import.meta.url,
    ),
    "utf8",
  ));

  for (const testCase of fixture.validCases) {
    assert.deepEqual(
      normalizeRoutingOverride(testCase.input),
      JSON.parse(testCase.canonicalIdentity),
      testCase.name,
    );
  }
  for (const testCase of fixture.invalidCases) {
    assert.throws(
      () => normalizeRoutingOverride(testCase.input),
      YirSDKValidationError,
      testCase.name,
    );
  }
});

test("budget validation matches int64 micro-dollar boundaries before transport", async () => {
  const calls = [];
  const client = createYirClient(async request => { calls.push(request); return { id: "7001", object: "job", status: "queued" }; });
  const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "one image" }, parameters: { resolution: "1K" } };
  for (const amount of ["9223372036854.775808", "9223372036855", "99999999999999999999999999", "0.0000001", "1e3", "-1", "01", "NaN", 1]) {
    assert.throws(() => client.submitImage({ ...request, max_cost: amount }, "saved-key"),
      error => error instanceof YirSDKValidationError && error.code === "max_cost_invalid" && error.path === "max_cost");
  }
  assert.equal(calls.length, 0);
  for (const amount of ["0", "0.000001", "9223372036854", "9223372036854.775807"]) {
    await client.submitImage({ ...request, max_cost: amount }, "saved-key");
    assert.equal(calls.at(-1).body.max_cost, amount);
  }
});

test("routing selectors fail closed before a request reaches the transport", () => {
  assert.throws(
    () => normalizeRoutingOverride({ preference: "cost", order: ["kie"] }),
    (error) => error instanceof YirSDKValidationError
      && error.code === "routing_unknown_field",
  );
});

test("the client delegates auth to a transport and fixes the public paths", async () => {
  const calls = [];
  const client = createYirClient(async (request) => {
    calls.push(request);
    if (request.path.endsWith("/quotes")) return quoteFixture(request.body,
      request.path.includes("/videos/") ? "generate_video" : "generate_image");
    return {
      id: "7001",
      object: "job",
      status: "queued",
      model: "openai/gpt-image-2",
      error: null,
      created_at: 1786160060,
    };
  });
  const body = buildImageGenerationRequest({
    model: "openai/gpt-image-2",
    prompt: "test",
    parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
  });
	const quoteBody = buildImageQuoteRequest({
		model: "openai/gpt-image-2",
		prompt: "test",
		parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
	});

	await client.quoteImage(quoteBody);
  await client.submitImage(body, "playground-7001");
  const videoBody = {
    model: "bytedance/seedance-2.0",
    input: { type: "text", prompt: "A paper boat crossing a rain-covered street" },
    parameters: { duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, n: 1 },
  };
  await client.quoteVideo(videoBody);
  await client.submitVideo(videoBody, "playground-video-7002");
  await client.getJob("7001");
  await client.getJobStatus("7001");
	await client.cancelJob("7001");

  assert.deepEqual(calls, [
		{
			method: "POST",
			path: "/v1/images/quotes",
			body: quoteBody,
		},
    {
      method: "POST",
      path: "/v1/images/generations",
      headers: { "Idempotency-Key": "playground-7001" },
      body,
    },
    {
      method: "POST",
      path: "/v1/videos/quotes",
      body: videoBody,
    },
    {
      method: "POST",
      path: "/v1/videos/generations",
      headers: { "Idempotency-Key": "playground-video-7002" },
      body: videoBody,
    },
    { method: "GET", path: "/v1/jobs/7001" },
    { method: "GET", path: "/v1/jobs/7001/status" },
		{ method: "POST", path: "/v1/jobs/7001/cancel" },
  ]);
});

test("video submit requires an idempotency key before transport", async () => {
  let calls = 0;
  const client = createYirClient(async () => {
    calls += 1;
    return {};
  });
  const request = {
    model: "bytedance/seedance-2.0",
    input: { type: "text", prompt: "fixture" },
    parameters: { duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, n: 1 },
  };

  assert.throws(() => client.submitVideo(request, "  "), /idempotency_key_required/);
  assert.equal(calls, 0);
});

test("image Quote and Submit share one normalized request contract", () => {
	const input = {
		model: "openai/gpt-image-2",
		prompt: "  A quiet observatory above a sea of clouds  ",
		parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
		routing: { preference: "cost", fallback: true },
	};
	const quote = buildImageQuoteRequest(input);
	const generation = buildImageGenerationRequest({
		...input,
		webhookUrl: "https://example.com/webhooks/yir",
		maxCost: "0.250001",
	});

	const { webhook_url: _webhookURL, max_cost: maxCost, ...generationContract } = generation;
	assert.equal(maxCost, "0.250001");
	assert.deepEqual(quote, generationContract);
	assert.equal("webhook_url" in quote, false);
	assert.equal("max_cost" in quote, false);
	assert.deepEqual(buildImageQuoteRequest({ ...input, maxCost: "0.250001" }), quote);
});

test("getJobStatus sends GET request to /v1/jobs/:id/status", async () => {
  const calls = [];
  const client = createYirClient(async request => {
    calls.push(request);
    return { id: "101", status: "running", error: null };
  });

  const status = await client.getJobStatus("101");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/v1/jobs/101/status");
  assert.equal(status.id, "101");
  assert.equal(status.status, "running");
  assert.equal(status.error, null);
});

test("waitForJob polls status and only fetches full job detail upon terminal status", async () => {
  const calls = [];
  let pollCount = 0;
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path === "/v1/jobs/202/status") {
      pollCount++;
      if (pollCount === 1) {
        return { id: "202", status: "queued", error: null };
      }
      if (pollCount === 2) {
        return { id: "202", status: "running", error: null };
      }
      return { id: "202", status: "succeeded", error: null };
    }
    if (request.path === "/v1/jobs/202") {
      return {
        id: "202",
        object: "job",
        model: "openai/gpt-image-2",
        status: "succeeded",
        error: null,
        created_at: 1786000000,
        result: { availability: "available", files: [{ url: "https://assets.example/result.png", media_type: "image/png", expires_at: 1786100000 }] },
        billing: { total_charged_by_yir: "0.02" },
      };
    }
    throw new Error(`Unexpected request path: ${request.path}`);
  });

  const polledStatuses = [];
  const job = await waitForJob(client, "202", {
    pollIntervalMs: 1,
    onPoll: status => {
      polledStatuses.push(status.status);
    },
  });

  assert.equal(job.id, "202");
  assert.equal(job.status, "succeeded");
  assert.equal(job.billing?.total_charged_by_yir, "0.02");

  // 3 status calls + 1 detail call
  assert.equal(calls.length, 4);
  assert.equal(calls[0].path, "/v1/jobs/202/status");
  assert.equal(calls[1].path, "/v1/jobs/202/status");
  assert.equal(calls[2].path, "/v1/jobs/202/status");
  assert.equal(calls[3].path, "/v1/jobs/202");

  assert.deepEqual(polledStatuses, ["queued", "running", "succeeded"]);
});

test("waitForJob throws YirJobError with full detail on terminal failure", async () => {
  const calls = [];
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path === "/v1/jobs/303/status") {
      return { id: "303", status: "failed", error: { code: "YIR_CONTENT_POLICY_VIOLATION", message: "Policy violation", retryable: false } };
    }
    if (request.path === "/v1/jobs/303") {
      return {
        id: "303",
        object: "job",
        model: "openai/gpt-image-2",
        status: "failed",
        error: { code: "YIR_CONTENT_POLICY_VIOLATION", message: "Policy violation", retryable: false },
        created_at: 1786000000,
      };
    }
    throw new Error(`Unexpected path: ${request.path}`);
  });

  await assert.rejects(
    async () => {
      await waitForJob(client, "303", { pollIntervalMs: 1 });
    },
    (err) => {
      assert.ok(err instanceof YirJobError);
      assert.equal(err.code, "YIR_CONTENT_POLICY_VIOLATION");
      assert.equal(err.job.id, "303");
      return true;
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/v1/jobs/303/status");
  assert.equal(calls[1].path, "/v1/jobs/303");
});

test("waitForJob times out and includes lastStatus on timeout", async () => {
  const client = createYirClient(async () => {
    return { id: "404", status: "running", error: null };
  });

  await assert.rejects(
    async () => {
      await waitForJob(client, "404", { pollIntervalMs: 5, timeoutMs: 15 });
    },
    (err) => {
      assert.ok(err instanceof YirTimeoutError);
      assert.equal(err.jobId, "404");
      assert.equal(err.lastStatus?.status, "running");
      return true;
    },
  );
});

test("waitForJob rejects terminal status detail mismatch with job_state_inconsistent", async () => {
  const client = createYirClient(async request => {
    if (request.path === "/v1/jobs/405/status") {
      return { id: "405", status: "succeeded", error: null };
    }
    if (request.path === "/v1/jobs/405") {
      return { id: "405", object: "job", status: "running", error: null, created_at: 1 };
    }
    throw new Error(`unexpected path: ${request.path}`);
  });

  await assert.rejects(
    () => waitForJob(client, "405", { pollIntervalMs: 1 }),
    /job_state_inconsistent/,
  );
});

test("waitForJob does not fetch detail when onPoll aborts", async () => {
  const controller = new AbortController();
  let detailCalls = 0;
  const client = {
    getJobStatus: async id => ({ id, status: "succeeded", error: null }),
    getJob: async () => {
      detailCalls++;
      return { id: "505", status: "succeeded" };
    },
  };

  await assert.rejects(
    () => waitForJob(client, "505", {
      signal: controller.signal,
      onPoll: () => controller.abort(new Error("caller_aborted")),
    }),
    /caller_aborted/,
  );
  assert.equal(detailCalls, 0);
});

test("waitForJob applies the same deadline to terminal detail", async () => {
  let detailSignal;
  const client = {
    getJobStatus: async id => ({ id, status: "succeeded", error: null }),
    getJob: async (_id, options) => {
      detailSignal = options?.signal;
      return new Promise(resolve => setTimeout(() => resolve({ id: "506", status: "succeeded" }), 30));
    },
  };

  await assert.rejects(
    () => waitForJob(client, "506", { timeoutMs: 10 }),
    error => error instanceof YirTimeoutError && error.jobId === "506",
  );
  assert.equal(detailSignal?.aborted, true);
});

test("waitForJob status 404 does not silently fallback to detail", async () => {
  let detailCalls = 0;
  const client = {
    getJobStatus: async () => {
      const err = new Error("Job not found");
      err.status = 404;
      throw err;
    },
    getJob: async () => {
      detailCalls++;
      return { id: "999", status: "succeeded" };
    },
  };

  await assert.rejects(
    () => waitForJob(client, "999", { pollIntervalMs: 1 }),
    err => err.status === 404,
  );
  assert.equal(detailCalls, 0);
});
