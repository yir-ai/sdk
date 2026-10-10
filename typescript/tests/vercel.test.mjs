import assert from "node:assert/strict";
import test from "node:test";
import { generateImage, experimental_generateVideo as generateVideo, experimental_startVideo as startVideo, experimental_getVideoStatus as getVideoStatus } from "ai";
import { createYirAIProvider } from "../dist/server/vercel.js";
import { createYirClient } from "../dist/server/client.js";
import { catalog } from "./catalog-fixture.mjs";

function fixture(mediaType = "image/png", notices = []) {
  const calls = [];
  let model;
  const client = createYirClient(async request => {
    calls.push(request);
    model = request.body?.model ?? model;
    return {
      object: "job", id: "42", model, status: "succeeded", error: null, created_at: 1786000000,
      parameter_notices: notices,
      result: { availability: "available", files: [{ url: "https://assets.example/result", media_type: mediaType, expires_at: 1786100000 }] },
      billing: { total_charged_by_yir: "0.020" },
    };
  });
  const provider = createYirAIProvider({ client, modelContracts: catalog, fetch: async (url, init) => {
    assert.equal(String(url), "https://assets.example/result");
    assert.equal(init.headers, undefined);
    assert.equal(init.redirect, "manual");
    return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200 });
  }});
  return { provider, calls };
}

test("AI SDK generateImage submits one validated Yir demand with original budget and key", async () => {
  const { provider, calls } = fixture();
  const result = await generateImage({
    model: provider.imageModel("openai/gpt-image-2"), prompt: "Observatory", aspectRatio: "1:1", maxRetries: 0,
    providerOptions: { yir: { idempotencyKey: "image-task-42", maxCost: "0.05", parameters: { resolution: "1K" } } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/v1/images/generations");
  assert.equal(calls[0].headers["Idempotency-Key"], "image-task-42");
  assert.deepEqual(calls[0].body.parameters, { resolution: "1K", aspect_ratio: "1:1", n: 1 });
  assert.equal(calls[0].body.max_cost, "0.05");
  assert.equal(result.images.length, 1);
  assert.equal(result.providerMetadata.yir.images[0].jobId, "42");
});

test("AI SDK image and video accept omitted keys and do not resubmit failures", async () => {
  for (const kind of ["image", "video"]) {
    const { provider, calls } = fixture(kind === "image" ? "image/png" : "video/mp4");
    if (kind === "image") {
      await generateImage({ model: provider.imageModel("openai/gpt-image-2"), prompt: "fixture" });
    } else {
      await startVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "fixture" });
    }
    assert.equal(calls.length, 1);
    assert.match(calls[0].headers["Idempotency-Key"], /^[0-9a-f-]{36}$/);
    let failures = 0;
    const failing = createYirAIProvider({ client: createYirClient(async () => { failures++; throw new TypeError("connection lost"); }) });
    await assert.rejects(kind === "image"
      ? generateImage({ model: failing.imageModel("openai/gpt-image-2"), prompt: "fixture" })
      : startVideo({ model: failing.videoModel("bytedance/seedance-2.0"), prompt: "fixture" }), /connection lost/);
    assert.equal(failures, 1);
  }
});

test("AI SDK generates one identity for Submit and its inline inputs per invocation", async () => {
  const calls = [];
  const fileID = "file_11111111-1111-4111-8111-111111111111";
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path === "/v1/files") return { files: request.body.files.map(file => ({ ...file, id: fileID, object: "file", status: "ready" })) };
    return { id: "42", status: "succeeded", created_at: 1,
      result: { availability: "available", files: [{ url: "https://assets.example/result", media_type: "image/png" }] } };
  });
  const provider = createYirAIProvider({ client, fetch: async () => new Response(new Uint8Array([137, 80, 78, 71])) });
  for (let index = 0; index < 2; index++) {
    await generateImage({ model: provider.imageModel("openai/gpt-image-2"), prompt: { text: "Edit", images: [new Uint8Array([137, 80, 78, 71])] } });
  }
  const uploads = calls.filter(request => request.path === "/v1/files");
  assert.equal(uploads.length, 2);
  assert.notEqual(uploads[0].headers["Idempotency-Key"], uploads[1].headers["Idempotency-Key"]);
  const submissions = calls.filter(request => request.path === "/v1/images/generations");
  assert.equal(submissions.length, 2);
  assert.notEqual(submissions[0].headers["Idempotency-Key"], submissions[1].headers["Idempotency-Key"]);
  for (const [index, request] of submissions.entries()) {
    assert.equal(uploads[index].headers["Idempotency-Key"], `${request.headers["Idempotency-Key"]}:inputs`);
    assert.deepEqual(request.body.input.references, [{ role: "reference_image", file_id: fileID }]);
  }
});

test("image adapter exposes actual parameter handling as warnings", async () => {
  const notice={name:"quality",disposition:"ignored",reason:"channel_parameter_unsupported",message:"Quality is not sent upstream."};
  const {provider,calls}=fixture("image/png",[notice]);
  const result=await provider.imageModel("openai/gpt-image-2").doGenerate({prompt:"fixture",n:1,providerOptions:{yir:{idempotencyKey:"warning-test",parameters:{resolution:"1K",aspect_ratio:"1:1",quality:"high"}}}});
  assert.deepEqual(result.warnings,[{type:"other",message:notice.message}]);
  assert.equal(calls[0].body.parameters.quality,"high");
});

test("AI SDK generateVideo uses native video parameters and result URL", async () => {
  const { provider, calls } = fixture("video/mp4");
  const result = await generateVideo({
    model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Paper boat", duration: 5, aspectRatio: "16:9", maxRetries: 0,
    download: async ({ url }) => { assert.equal(String(url), "https://assets.example/result"); return { data: new Uint8Array([0, 0, 0, 0]), mediaType: "video/mp4" }; },
    poll: { intervalMs: 1 },
    providerOptions: { yir: { idempotencyKey: "video-task-42", parameters: { resolution: "720p", generate_audio: false } } },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/v1/videos/generations");
  assert.equal(calls[1].path, "/v1/jobs/42");
  assert.equal(calls[0].body.parameters.duration, 5);
  assert.equal(result.videos.length, 1);
  assert.equal(result.providerMetadata.yir.jobId, "42");
});

test("startVideo operation survives provider reconstruction and does not resubmit", async () => {
  const calls = [];
  let status = "queued";
  const client = createYirClient(async request => {
    calls.push(request);
    return { object: "job", id: "55", model: "bytedance/seedance-2.0", status, created_at: 1786000000, error: null,
      cancellation: { status: "stop_requested", effect: "stop_future_attempts" },
      result: status === "succeeded" ? { availability: "available", files: [{ url: "https://example.com/video.mp4", media_type: "video/mp4" }] } : undefined,
      billing: status === "succeeded" ? { total_charged_by_yir: "0.04" } : undefined };
  });
  const model = createYirAIProvider({ client }).videoModel("bytedance/seedance-2.0");
  const started = await startVideo({ model, prompt: "Animate", webhookUrl: "https://example.com/yir-webhook", maxRetries: 0,
    providerOptions: { yir: { idempotencyKey: "persisted-key", maxCost: "0.05" } } });
  assert.deepEqual(started.operation, { jobId: "55", modelId: "bytedance/seedance-2.0" });
  assert.equal(calls[0].body.webhook_url, "https://example.com/yir-webhook");
  assert.equal(calls[0].headers["Idempotency-Key"], "persisted-key");
  const restored = JSON.parse(JSON.stringify(started.operation));
  const restoredModel = createYirAIProvider({ client }).videoModel("bytedance/seedance-2.0");
  for (status of ["queued", "running", "delivering", "pending_review"]) {
    const result = await getVideoStatus(restoredModel, { operation: restored, maxRetries: 0 });
    assert.equal(result.status, "pending");
  }
  status = "succeeded";
  const completed = await getVideoStatus(restoredModel, { operation: restored, maxRetries: 0 });
  assert.equal(completed.status, "completed");
  assert.equal(completed.videos[0].url, "https://example.com/video.mp4");
  assert.equal(completed.providerMetadata.yir.totalChargedByYir, "0.04");
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
});

test("async status preserves terminal error and zero customer charge", async () => {
  for (const status of ["failed", "cancelled"]) {
    const client = createYirClient(async () => ({ id: "55", model: "bytedance/seedance-2.0", status, created_at: 1,
      error: status === "failed" ? { code: "YIR_OUTCOME_TIMEOUT" } : null, billing: { total_charged_by_yir: "0.000" } }));
    const result = await getVideoStatus(createYirAIProvider({ client }).videoModel("bytedance/seedance-2.0"), {
      operation: { jobId: "55", modelId: "bytedance/seedance-2.0" }, maxRetries: 0,
    });
    assert.equal(result.status, "error");
    assert.equal(result.error, status === "failed" ? "YIR_OUTCOME_TIMEOUT" : "YIR_JOB_CANCELLED");
    assert.equal(result.providerMetadata.yir.totalChargedByYir, "0.000");
  }
});

test("aborted start never submits and aborted status never sends cancellation", async () => {
  const { provider, calls } = fixture("video/mp4");
  const abortSignal = AbortSignal.abort(new Error("local-stop"));
  const model = provider.videoModel("bytedance/seedance-2.0");
  await assert.rejects(() => startVideo({ model, prompt: "Animate", abortSignal, maxRetries: 0,
    providerOptions: { yir: { idempotencyKey: "persisted-key" } } }), /local-stop/);
  await assert.rejects(() => getVideoStatus(model, { operation: { jobId: "42", modelId: "bytedance/seedance-2.0" }, abortSignal, maxRetries: 0 }), /local-stop/);
  assert.equal(calls.length, 0);
});

test("operation for another model is rejected before querying", async () => {
  const { provider, calls } = fixture("video/mp4");
  await assert.rejects(() => getVideoStatus(provider.videoModel("bytedance/seedance-2.0"), {
    operation: { jobId: "42", modelId: "other/model" }, maxRetries: 0,
  }), /operation_invalid/);
  assert.equal(calls.length, 0);
});

test("explicit URL video references are rejected before transport", async () => {
  const { provider, calls } = fixture("video/mp4");
  await assert.rejects(() => provider.videoModel("bytedance/seedance-2.0").doStart({
    prompt: "Animate", n: 1, frameImages: [],
    inputReferences: [{ type: "url", url: "https://example.com/ref.png", mediaType: "image/png" }],
    providerOptions: { yir: { idempotencyKey: "reference-key" } },
  }), /URL media inputs/);
  assert.equal(calls.length, 0);
});

test("AI SDK default retries do not resubmit an unknown Yir transport outcome", async () => {
  let calls = 0;
  const client = createYirClient(async () => { calls++; throw new TypeError("connection lost"); });
  const provider = createYirAIProvider({ client });
  await assert.rejects(() => startVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Animate",
    providerOptions: { yir: { idempotencyKey: "original-key" } } }), /connection lost/);
  assert.equal(calls, 1);
});

test("AI SDK inline image uploads once and submits a ready File ID", async () => {
  const events = [];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const fileID = "file_11111111-1111-4111-8111-111111111111";
  let metadata;
  const client = createYirClient(async request => {
    events.push(request.path);
    if (request.path === "/v1/files") {
      metadata = request.body.files[0];
      assert.equal(request.headers["Idempotency-Key"], "inline-key:inputs");
      assert.match(metadata.name, /^reference-0-[0-9a-f]{64}$/);
      return { files: [{ ...metadata, id: fileID, object: "file", status: "pending_upload",
        upload: { type: "multipart", expires_at: Math.floor(Date.now() / 1000) + 300,
          parts: [{ part_number: 1, size: png.length, url: "https://uploads.example/part" }] } }] };
    }
    if (request.path.endsWith("/complete")) return { ...metadata, id: fileID, object: "file", status: "ready" };
    assert.equal(request.path, "/v1/images/generations");
    assert.deepEqual(request.body.input.references, [{ role: "reference_image", file_id: fileID }]);
    assert.equal(JSON.stringify(request.body).includes("pending-upload"), false);
    return { id: "42", status: "succeeded", created_at: 1,
      result: { availability: "available", files: [{ url: "https://assets.example/result", media_type: "image/png" }] } };
  });
  const provider = createYirAIProvider({ client, fetch: async (url, request) => {
    events.push(String(url));
    if (String(url).includes("uploads.example")) {
      assert.equal(request.headers, undefined);
      assert.deepEqual(new Uint8Array(await request.body.arrayBuffer()), png);
      return new Response(null, { status: 200 });
    }
    return new Response(png, { status: 200 });
  }});
  await generateImage({ model: provider.imageModel("openai/gpt-image-2"), prompt: { text: "Edit", images: [png] }, maxRetries: 0,
    providerOptions: { yir: { idempotencyKey: "inline-key" } } });
  assert.deepEqual(events, ["/v1/files", "https://uploads.example/part", `/v1/files/${fileID}/complete`, "/v1/images/generations", "https://assets.example/result"]);
});

test("AI SDK startVideo uploads mixed audio/image/video references", async () => {
  const calls = [];
  const ids = ["file_11111111-1111-4111-8111-111111111111", "file_22222222-2222-4222-8222-222222222222", "file_33333333-3333-4333-8333-333333333333"];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const wav = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]);
  const video = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]);
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path === "/v1/files") {
      assert.equal(request.headers["Idempotency-Key"], "mixed-video:inputs");
      assert.deepEqual(request.body.files.map(file => [file.media_type, file.size]), [["image/png", png.length], ["video/mp4", video.length], ["audio/wav", wav.length]]);
      return { files: request.body.files.map((file, index) => ({ ...file, id: ids[index], object: "file", status: "ready" })) };
    }
    assert.equal(request.path, "/v1/videos/generations");
    assert.equal(request.headers["Idempotency-Key"], "mixed-video");
    assert.deepEqual(request.body.input, { type: "reference", prompt: "Animate with sound", references: [
      { role: "reference_image", file_id: ids[0] },
      { role: "reference_video", file_id: ids[1] },
      { role: "reference_audio", file_id: ids[2] },
    ] });
    return { id: "42", object: "job", status: "queued", created_at: 1 };
  });
  const provider = createYirAIProvider({ client, fetch: async () => { throw new Error("ready files must not upload again"); } });
  const result = await startVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Animate with sound", maxRetries: 0,
    inputReferences: [{ data: png, mediaType: "image/png" }, { data: video, mediaType: "video/mp4" }, { data: wav, mediaType: "audio/wav" }],
    providerOptions: { yir: { idempotencyKey: "mixed-video" } },
  });
  assert.equal(result.operation.jobId, "42");
  assert.equal(calls.length, 2);
});

test("invalid generation parameters do not upload inline media", async () => {
  const { provider, calls } = fixture();
  await assert.rejects(() => generateImage({ model: provider.imageModel("openai/gpt-image-2"),
    prompt: { text: "Edit", images: [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])] }, maxRetries: 0,
    providerOptions: { yir: { idempotencyKey: "inline-key", parameters: { unknown: true } } } }));
  assert.equal(calls.length, 0);
});

test("unsupported output counts do not fan out into separately charged jobs", async () => {
  const { provider, calls } = fixture();
  await assert.rejects(() => generateImage({
    model: provider.imageModel("openai/gpt-image-2"), prompt: "Two images", n: 2, maxRetries: 0,
    providerOptions: { yir: { idempotencyKey: "one-key" } },
  }));
  assert.equal(calls.length, 0);
});

test("unknown parameters and conflicting generic options fail before Submit", async () => {
  for (const parameters of [{ private_provider_key: "not-a-real-key" }, { aspect_ratio: "16:9" }]) {
    const { provider, calls } = fixture();
    await assert.rejects(() => generateImage({
      model: provider.imageModel("openai/gpt-image-2"), prompt: "Image", aspectRatio: "1:1", maxRetries: 0,
      providerOptions: { yir: { idempotencyKey: "key", parameters } },
    }));
    assert.equal(calls.length, 0);
  }
});

test("AI SDK generateImage waits for a running Yir job before downloading", async () => {
  const paths = [];
  let statusPolls = 0;
  const done = {
    object: "job", id: "43", model: "openai/gpt-image-2", status: "succeeded", error: null, created_at: 1786000000,
    result: { availability: "available", files: [{ url: "https://assets.example/result", media_type: "image/png", expires_at: 1786100000 }] },
  };
  const client = createYirClient(async request => {
    paths.push(request.path);
    if (request.path === "/v1/images/generations") return { ...done, status: "running", result: undefined };
    if (request.path.startsWith("/v1/jobs/43/status")) return { id: "43", status: ++statusPolls < 2 ? "running" : "succeeded", error: null };
    if (request.path === "/v1/jobs/43") return done;
    throw new Error(`unexpected ${request.path}`);
  });
  const provider = createYirAIProvider({
    client, modelContracts: catalog, pollIntervalMs: 1,
    fetch: async () => new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200 }),
  });
  const result = await generateImage({ model: provider.imageModel("openai/gpt-image-2"), prompt: "Observatory", maxRetries: 0 });
  assert.deepEqual(paths, ["/v1/images/generations", "/v1/jobs/43/status?wait=20", "/v1/jobs/43/status?wait=20", "/v1/jobs/43"]);
  assert.equal(result.images.length, 1);
  assert.equal(result.providerMetadata.yir.images[0].jobId, "43");
});

test("AI SDK seed and fps reach Yir only where the catalog declares them", async () => {
  const calls = [];
  const transport = async request => { calls.push(request); return { object: "job", id: "job_43", model: request.body.model, status: "queued", created_at: 1786000000, error: null }; };
  const options = { prompt: "fixture", n: 1, seed: 7, fps: 24, providerOptions: { yir: { idempotencyKey: "seed-test" } } };
  const bare = await createYirAIProvider({ client: createYirClient(transport) }).videoModel("future/video").doStart(options);
  assert.deepEqual(calls[0].body.parameters, { n: 1, fps: 24, seed: 7 }, "without a catalog the Gateway decides");
  assert.deepEqual(bare.warnings, []);
  assert.deepEqual(bare.operation, { jobId: "job_43", modelId: "future/video" });

  const base = structuredClone(catalog.models.find(model => model.id === "bytedance/seedance-2.0"));
  const seed = { name: "seed", type: "integer", required: false, minimum: 0, maximum: 2147483647, control: "number",
    locales: { en: { label: "Seed", description: "Seed" }, "zh-CN": { label: "种子", description: "种子" } } };
  base.id = "future/video";
  base.aliases = [];
  for (const operation of base.operations) operation.parameters = [...operation.parameters, seed];
  const declared = { ...catalog, models: [...catalog.models, base] };
  const undeclared = await createYirAIProvider({ client: createYirClient(transport, catalog) }).videoModel("bytedance/seedance-2.0").doStart(options);
  assert.equal("seed" in calls[1].body.parameters || "fps" in calls[1].body.parameters, false);
  assert.deepEqual(undeclared.warnings.map(warning => [warning.type, warning.feature]), [["unsupported", "fps"], ["unsupported", "seed"]]);
  const result = await createYirAIProvider({ client: createYirClient(transport, declared) }).videoModel("future/video").doStart(options);
  assert.equal(calls[2].body.parameters.seed, 7);
  assert.equal("fps" in calls[2].body.parameters, false);
  assert.deepEqual(result.warnings.map(warning => warning.feature), ["fps"]);
});
