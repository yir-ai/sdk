import assert from "node:assert/strict";
import test from "node:test";
import { APICallError } from "@ai-sdk/provider";
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

test("AI SDK video keeps returned last frames out of videos and preserves additional results", async () => {
  const video = { url: "https://assets.example/video.mp4", media_type: "video/mp4", expires_at: 1786100000 };
  const tail = { url: "https://assets.example/tail.png", media_type: "image/png", expires_at: 1786100000,
    fidelity: { grade: "original", reason: "verified" } };
  for (const files of [[video, tail], [tail, video]]) {
    const calls = [];
    const downloads = [];
    const provider = createYirAIProvider({ client: createYirClient(async request => {
      calls.push(request);
      return { id: "42", status: "succeeded", created_at: 1, result: { availability: "available", files } };
    }) });
    const result = await generateVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Animate", maxRetries: 0,
      providerOptions: { yir: { parameters: { return_last_frame: true } } }, poll: { intervalMs: 1 },
      download: async ({ url }) => { downloads.push(String(url)); return { data: new Uint8Array([0]), mediaType: "video/mp4" }; },
    });
    assert.equal(calls[0].body.parameters.return_last_frame, true);
    assert.equal(result.videos.length, 1);
    assert.deepEqual(downloads, [video.url]);
    assert.deepEqual(result.providerMetadata.yir.additionalFiles, [tail]);
    const status = await getVideoStatus(provider.videoModel("bytedance/seedance-2.0"), {
      operation: { jobId: "42", modelId: "bytedance/seedance-2.0" }, maxRetries: 0,
    });
    assert.equal(status.videos.length, 1);
    assert.deepEqual(status.providerMetadata.yir.additionalFiles, [tail]);
  }
});

test("video status cannot report an image-only result as completed video output", async () => {
  const { provider } = fixture("image/png");
  await assert.rejects(() => getVideoStatus(provider.videoModel("bytedance/seedance-2.0"), {
    operation: { jobId: "42", modelId: "bytedance/seedance-2.0" }, maxRetries: 0,
  }), /yir_result_unavailable/);
});

test("video status preserves parameter notices and missing additional output warnings", async () => {
  const provider = createYirAIProvider({ client: createYirClient(async () => ({ id: "42", status: "succeeded", created_at: 1,
    parameter_notices: [{ message: "Parameter notice." }],
    result: { availability: "available", files: [{ url: "https://assets.example/video.mp4", media_type: "video/mp4" }], warnings: ["additional_results_unavailable"] },
  })) });
  const result = await getVideoStatus(provider.videoModel("bytedance/seedance-2.0"), {
    operation: { jobId: "42", modelId: "bytedance/seedance-2.0" }, maxRetries: 0,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.warnings, [{ type: "other", message: "Parameter notice." }, { type: "other", message: "additional_results_unavailable" }]);
  assert.equal(result.providerMetadata.yir.additionalFiles, undefined);
});

test("standard video parameters preserve zero, false, adaptive ratio and omitted defaults", async () => {
  for (const settings of [{}, { seed: 0, generateAudio: false, duration: 5, aspectRatio: "adaptive" }]) {
    const { provider, calls } = fixture("video/mp4");
    const parameters = { resolution: "720p" };
    await startVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Animate", ...settings,
      providerOptions: { yir: { parameters } }, maxRetries: 0 });
    assert.deepEqual(calls[0].body.parameters, { resolution: "720p", n: 1,
      ...(Object.keys(settings).length ? { seed: 0, generate_audio: false, duration: 5, aspect_ratio: "adaptive" } : {}) });
    assert.deepEqual(parameters, { resolution: "720p" });
  }
});

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
    assert.match(calls[0].headers["Idempotency-Key"], kind === "image" ? /^[0-9a-f-]{36}$/ : /^aisdk_vid_/);
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

test("unsafe URL video references are rejected before transport", async () => {
  const { provider, calls } = fixture("video/mp4");
  await assert.rejects(() => provider.videoModel("bytedance/seedance-2.0").doStart({
    prompt: "Animate", n: 1, frameImages: [],
    inputReferences: [{ type: "url", url: "http://example.com/ref.png", mediaType: "image/png" }],
    providerOptions: { yir: { idempotencyKey: "reference-key" } },
  }), /url_invalid/);
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

test("invalid protocol budgets do not upload inline media", async () => {
  const { provider, calls } = fixture();
  await assert.rejects(() => generateImage({ model: provider.imageModel("openai/gpt-image-2"),
    prompt: { text: "Edit", images: [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])] }, maxRetries: 0,
    providerOptions: { yir: { idempotencyKey: "inline-key", maxCost: "invalid" } } }));
  assert.equal(calls.length, 0);
});

test("output counts reach the Gateway as one job without client fan-out", async () => {
  const { provider, calls } = fixture();
  await generateImage({
    model: provider.imageModel("openai/gpt-image-2"), prompt: "Two images", n: 2, maxRetries: 0,
    providerOptions: { yir: { idempotencyKey: "one-key" } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.parameters.n, 2);
});

test("conflicting generic options fail before Submit", async () => {
  for (const parameters of [{ aspect_ratio: "16:9" }]) {
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

test("AI SDK seed and fps reach Yir even when a local catalog lacks them", async () => {
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
  assert.deepEqual(calls[1].body.parameters, { n: 1, fps: 24, seed: 7 });
  assert.deepEqual(undeclared.warnings, []);
  const result = await createYirAIProvider({ client: createYirClient(transport, declared) }).videoModel("future/video").doStart(options);
  assert.equal(calls[2].body.parameters.seed, 7);
  assert.equal(calls[2].body.parameters.fps, 24);
  assert.deepEqual(result.warnings, []);
});


test("AI SDK image URL inputs reach the Gateway without local downloads or uploads", async () => {
  const { provider, calls } = fixture();
  await generateImage({ model: provider.imageModel("openai/gpt-image-2"),
    prompt: { text: "Edit", images: ["https://example.com/reference.png?signature=fixture"] }, maxRetries: 0 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.input.references, [{ role: "reference_image", url: "https://example.com/reference.png?signature=fixture" }]);
});

test("AI SDK video maps URL first/last frames and standard generation parameters", async () => {
  const { provider, calls } = fixture("video/mp4");
  await startVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Animate", maxRetries: 0,
    frameImages: [{ frameType: "first_frame", image: "https://example.com/first.png" },
      { frameType: "last_frame", image: "https://example.com/last.png" }],
    aspectRatio: "adaptive", duration: 5, generateAudio: false });
  assert.deepEqual(calls[0].body.input, { type: "image", prompt: "Animate", references: [
    { role: "first_frame", url: "https://example.com/first.png" }, { role: "last_frame", url: "https://example.com/last.png" },
  ] });
  assert.deepEqual(calls[0].body.parameters, { n: 1, aspect_ratio: "adaptive", duration: 5, generate_audio: false });
});

test("mixed URL and inline video references preserve source, role and order", async () => {
  const calls = [];
  const fileID = "file_11111111-1111-4111-8111-111111111111";
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path === "/v1/files") return { files: request.body.files.map(file => ({ ...file, id: fileID, object: "file", status: "ready" })) };
    return { id: "42", status: "queued", created_at: 1 };
  });
  const provider = createYirAIProvider({ client, fetch: async () => { throw new Error("must not download URL references"); } });
  await startVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Animate", maxRetries: 0,
    inputReferences: [
      { data: "https://example.com/image.png", mediaType: "image/png" },
      { data: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]), mediaType: "video/mp4" },
      { data: "https://example.com/audio.wav", mediaType: "audio/wav" },
    ], providerOptions: { yir: { idempotencyKey: "mixed-sources" } } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.files.length, 1);
  assert.equal(calls[0].body.files[0].media_type, "video/mp4");
  assert.deepEqual(calls[1].body.input.references, [
    { role: "reference_image", url: "https://example.com/image.png" },
    { role: "reference_video", file_id: fileID },
    { role: "reference_audio", url: "https://example.com/audio.wav" },
  ]);
});

test("unsafe media URLs fail before uploading any inline input", async () => {
  for (const url of ["http://example.com/a.png", "https://user:password@example.com/a.png", "https://example.com/a.png#fragment", "not-a-url"]) {
    const { provider, calls } = fixture();
    await assert.rejects(() => provider.imageModel("openai/gpt-image-2").doGenerate({ prompt: "Edit", n: 1,
      files: [{ type: "file", mediaType: "image/png", data: new Uint8Array([137, 80, 78, 71]) }, { type: "url", url }],
      providerOptions: {} }), error => error.code === "url_invalid" && error.path === "input.references.1.url");
    assert.equal(calls.length, 0);
  }
});

test("optional parameter conflicts are rejected even when the catalog omits the parameter", async () => {
  for (const [field, value] of [["seed", 7], ["fps", 24]]) {
    const calls = [];
    const client = createYirClient(async request => { calls.push(request); return { id: "42", status: "queued", created_at: 1 }; }, catalog);
    const model = createYirAIProvider({ client }).videoModel("bytedance/seedance-2.0");
    await assert.rejects(() => startVideo({ model, prompt: "Animate", [field]: value, maxRetries: 0,
      providerOptions: { yir: { parameters: { [field]: value + 1 } } } }), error => error.code === "parameter_conflict");
    assert.equal(calls.length, 0);
  }
});

test("a stale catalog does not discard explicit seed for a different input mode", async () => {
  const custom = structuredClone(catalog);
  const base = custom.models.find(model => model.id === "bytedance/seedance-2.0");
  const text = structuredClone(base.operations.find(operation => operation.operation === "generate_video" && operation.input_modes.includes("text")));
  text.input_modes = ["text"];
  const image = structuredClone(text);
  image.input_modes = ["image"];
  image.parameters = image.parameters.filter(parameter => parameter.name !== "seed");
  text.parameters = [...text.parameters.filter(parameter => parameter.name !== "seed"), { name: "seed", type: "integer", required: false, control: "number", locales: {} }];
  base.operations = [text, image];
  const calls = [];
  const client = createYirClient(async request => { calls.push(request); return { id: "42", status: "queued", created_at: 1 }; });
  const model = createYirAIProvider({ client, modelContracts: custom }).videoModel(base.id);
  const result = await startVideo({ model, prompt: { text: "Animate", image: "https://example.com/input.png" }, seed: 7, maxRetries: 0 });
  assert.equal(calls[0].body.parameters.seed, 7);
  assert.deepEqual(result.warnings, []);
  await startVideo({ model, prompt: "Animate", seed: 0, maxRetries: 0 });
  assert.equal(calls[1].body.parameters.seed, 0);
});

test("masks fail explicitly before transport", async () => {
  const { provider, calls } = fixture();
  const image = new Uint8Array([137, 80, 78, 71]);
  await assert.rejects(() => generateImage({ model: provider.imageModel("openai/gpt-image-2"), prompt: { text: "Edit", images: [image], mask: image }, maxRetries: 0 }), /image mask/);
  assert.equal(calls.length, 0);
});


test("prompt image with a last frame preserves both endpoints", async () => {
  const { provider, calls } = fixture("video/mp4");
  await startVideo({ model: provider.videoModel("bytedance/seedance-2.0"), maxRetries: 0,
    prompt: { text: "Animate", image: "https://example.com/first.png" },
    frameImages: [{ frameType: "last_frame", image: "https://example.com/last.png" }] });
  assert.deepEqual(calls[0].body.input.references, [
    { role: "first_frame", url: "https://example.com/first.png" }, { role: "last_frame", url: "https://example.com/last.png" },
  ]);
});

test("AI SDK inline first frame mirror uploads once and retains the last frame", async () => {
  const calls = [];
  const firstID = "file_11111111-1111-4111-8111-111111111111";
  const lastID = "file_22222222-2222-4222-8222-222222222222";
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path === "/v1/files") return { files: request.body.files.map((file, index) => ({ ...file, id: [firstID, lastID][index], object: "file", status: "ready" })) };
    return { id: "42", status: "queued", created_at: 1 };
  });
  await startVideo({ model: createYirAIProvider({ client }).videoModel("bytedance/seedance-2.0"), prompt: "Animate", maxRetries: 0,
    frameImages: [{ frameType: "first_frame", image: new Uint8Array([137, 80, 78, 71]) },
      { frameType: "last_frame", image: new Uint8Array([137, 80, 78, 71, 1]) }] });
  assert.equal(calls[0].body.files.length, 2);
  assert.deepEqual(calls[1].body.input.references, [{ role: "first_frame", file_id: firstID }, { role: "last_frame", file_id: lastID }]);
});

test("prompt image maps to a single first frame and mixed frame/reference sources remain explicit errors", async () => {
  const { provider, calls } = fixture("video/mp4");
  const model = provider.videoModel("bytedance/seedance-2.0");
  await startVideo({ model, prompt: { text: "Animate", image: "https://example.com/first.png" }, maxRetries: 0 });
  assert.deepEqual(calls[0].body.input.references, [{ role: "first_frame", url: "https://example.com/first.png" }]);
  await assert.rejects(() => model.doStart({ prompt: "Animate", n: 1, providerOptions: {},
    image: { type: "url", url: "https://example.com/first.png" },
    inputReferences: [{ type: "url", url: "https://example.com/reference.png", mediaType: "image/png" }] }), /input_sources_ambiguous/);
  assert.equal(calls.length, 1);
});


test("standard idempotency headers preserve image/video submission identity", async () => {
  for (const kind of ["image", "video"]) {
    const { provider, calls } = fixture(kind === "image" ? "image/png" : "video/mp4");
    const options = { prompt: "Fixture", headers: { "iDeMpOtEnCy-KeY": "saved-business-key" }, maxRetries: 0 };
    if (kind === "image") await generateImage({ ...options, model: provider.image("openai/gpt-image-2") });
    else await startVideo({ ...options, model: provider.video("bytedance/seedance-2.0") });
    assert.equal(calls[0].headers["Idempotency-Key"], "saved-business-key");
  }
});

test("existing Yir key retains priority over an AI SDK header key", async () => {
  for (const kind of ["image", "video"]) {
    const { provider, calls } = fixture(kind === "image" ? "image/png" : "video/mp4");
    const options = { prompt: "Fixture", headers: { "Idempotency-Key": "other-sdk-key" }, maxRetries: 0,
      providerOptions: { yir: { idempotencyKey: "persisted-yir-key" } } };
    if (kind === "image") await generateImage({ ...options, model: provider.imageModel("openai/gpt-image-2") });
    else await startVideo({ ...options, model: provider.videoModel("bytedance/seedance-2.0") });
    assert.equal(calls[0].headers["Idempotency-Key"], "persisted-yir-key");
  }
});

test("AI SDK outer video retry reuses both submission and inline-upload keys", async () => {
  const calls = [];
  let submissions = 0;
  const fileID = "file_11111111-1111-4111-8111-111111111111";
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path === "/v1/files") return { files: request.body.files.map(file => ({ ...file, id: fileID, object: "file", status: "ready" })) };
    if (++submissions === 1) throw new APICallError({ message: "fixture temporary failure", url: "https://gateway.example/v1/videos/generations", requestBodyValues: {}, statusCode: 503 });
    return { id: "42", status: "queued", created_at: 1 };
  });
  await startVideo({ model: createYirAIProvider({ client }).videoModel("bytedance/seedance-2.0"),
    prompt: { text: "Animate", image: new Uint8Array([137, 80, 78, 71]) }, maxRetries: 1 });
  const submits = calls.filter(call => call.path === "/v1/videos/generations");
  const uploads = calls.filter(call => call.path === "/v1/files");
  assert.equal(submits.length, 2);
  assert.match(submits[0].headers["Idempotency-Key"], /^aisdk_vid_/);
  assert.equal(submits[0].headers["Idempotency-Key"], submits[1].headers["Idempotency-Key"]);
  assert.deepEqual(submits[0].body, submits[1].body);
  assert.equal(uploads[0].headers["Idempotency-Key"], uploads[1].headers["Idempotency-Key"]);
  assert.equal(uploads[0].headers["Idempotency-Key"], `${submits[0].headers["Idempotency-Key"]}:inputs`);
});

test("invalid or ambiguous standard keys fail without echoing secrets or sending requests", async () => {
  for (const headers of [
    { "Idempotency-Key": null }, { "Idempotency-Key": 12345 }, { "Idempotency-Key": " " }, { "Idempotency-Key": "secret-key\r\nextra" },
    { "Idempotency-Key": "first-secret", "idempotency-key": "second-secret" },
  ]) {
    const { provider, calls } = fixture();
    await assert.rejects(() => provider.imageModel("openai/gpt-image-2").doGenerate({ prompt: "Image", n: 1, headers, providerOptions: {} }), error => {
      assert.equal(error.code, "idempotency_key_invalid");
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
    assert.equal(calls.length, 0);
  }
});

test("standard key support does not forward arbitrary headers or permit credential overrides", async () => {
  for (const headers of [{ Authorization: "Bearer fixture-only" }, { "X-Custom": "value", "Idempotency-Key": "key" }]) {
    const { provider, calls } = fixture();
    await assert.rejects(() => generateImage({ model: provider.imageModel("openai/gpt-image-2"), prompt: "Image", headers, maxRetries: 0 }), /per-call headers/);
    assert.equal(calls.length, 0);
  }
});

test("Provider aliases and editing capabilities are additive and never fetch a catalog", () => {
  const client = createYirClient(async () => { throw new Error("capability checks must not send requests"); });
  const unknown = createYirAIProvider({ client });
  assert.equal(unknown.image, unknown.imageModel);
  assert.equal(unknown.video, unknown.videoModel);
  assert.equal(unknown.image("openai/gpt-image-2").supportsFileInputs, undefined);
  assert.equal(unknown.image("openai/gpt-image-2").supportsMaskInputs, false);
  const provider = createYirAIProvider({ client, modelContracts: catalog });
  assert.equal(provider.image("openai/gpt-image-2").supportsFileInputs, true);
  assert.equal(provider.image("unlisted/model").supportsFileInputs, undefined);
  const textOnly = structuredClone(catalog.models.find(model => model.id === "openai/gpt-image-2"));
  textOnly.operations = textOnly.operations.filter(operation => operation.input_modes.includes("text"));
  for (const operation of textOnly.operations) operation.input_modes = ["text"];
  const noEdit = createYirAIProvider({ client, modelContracts: { ...catalog, models: [textOnly] } });
  assert.equal(noEdit.image(textOnly.id).supportsFileInputs, false);
  assert.equal(noEdit.image(textOnly.id).supportsMaskInputs, false);
});


test("AI SDK generateVideo carries the standard key through status polling", async () => {
  const { provider, calls } = fixture("video/mp4");
  const result = await generateVideo({
    model: provider.video("bytedance/seedance-2.0"), prompt: "Paper boat", maxRetries: 0,
    headers: { "Idempotency-Key": "video-poll-key" }, poll: { intervalMs: 1 },
    download: async () => ({ data: new Uint8Array([0, 0, 0, 0]), mediaType: "video/mp4" }),
  });
  assert.equal(result.videos.length, 1);
  assert.equal(calls[0].headers["Idempotency-Key"], "video-poll-key");
  assert.equal(calls[1].path, "/v1/jobs/42");
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  assert.equal(calls[1].headers?.["Idempotency-Key"], undefined);
});


test("AI SDK pixel dimensions reach Yir unchanged without approximate tiers", async () => {
  const image = fixture();
  await generateImage({ model: image.provider.image("bytedance/seedream-5.0-pro"), prompt: "Image", size: "3136x1344", maxRetries: 0 });
  assert.deepEqual(image.calls[0].body.parameters, { n: 1, size: "3136x1344" });
  const video = fixture("video/mp4");
  await startVideo({ model: video.provider.video("bytedance/seedance-2.0"), prompt: "Video", resolution: "1280x720", maxRetries: 0 });
  assert.equal(video.calls[0].body.parameters.size, "1280x720");
  assert.equal(video.calls[0].body.parameters.resolution, undefined);
  // Gateway owns current channel support, including models absent from a stale local catalog.
  await assert.rejects(() => generateImage({ model: image.provider.image("bytedance/seedream-5.0-pro"), prompt: "Image", size: "1024x1024", maxRetries: 0,
    providerOptions: { yir: { parameters: { size: "2048x2048" } } } }), /parameter_conflict/);
  assert.equal(image.calls.length, 1);
});


test("AI SDK webhook factory wakes the original video job without polling or trusting its payload", async () => {
  const calls = [];
  let notify, submitted;
  const received = new Promise(resolve => { notify = resolve; });
  const started = new Promise(resolve => { submitted = resolve; });
  let factories = 0;
  const provider = createYirAIProvider({ client: createYirClient(async request => {
    calls.push(request);
    if (request.method === "POST") {
      submitted();
      return { id: "42", status: "queued", created_at: 1 };
    }
    assert.equal(request.path, "/v1/jobs/42");
    return { id: "42", status: "succeeded", created_at: 1,
      result: { availability: "available", files: [{ url: "https://assets.example/original.mp4", media_type: "video/mp4" }] } };
  }) });
  const pending = generateVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Animate", maxRetries: 0,
    webhook: async () => { factories++; return { url: "https://example.com/yir-hook", received }; },
    providerOptions: { yir: { idempotencyKey: "webhook-video" } },
    download: async ({ url }) => {
      assert.equal(String(url), "https://assets.example/original.mp4");
      return { data: new Uint8Array([0]), mediaType: "video/mp4" };
    },
  });
  await started;
  assert.equal(factories, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.webhook_url, "https://example.com/yir-hook");
  assert.equal(calls[0].headers["Idempotency-Key"], "webhook-video");
  // Even a payload naming another job cannot select the result or its URL.
  notify({ headers: {}, body: { id: "99", url: "https://untrusted.example/video.mp4" } });
  const result = await pending;
  assert.equal(result.videos.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(result.providerMetadata.yir.jobId, "42");
  assert.equal(result.warnings.some(warning => warning.feature === "webhook"), false);
});

test("AI SDK webhook factory failures and invalid URLs never submit or upload", async () => {
  for (const webhook of [
    async () => { throw new Error("fixture factory failure"); },
    async () => ({ url: "http://example.com/hook", received: new Promise(() => {}) }),
  ]) {
    const { provider, calls } = fixture("video/mp4");
    await assert.rejects(() => generateVideo({ model: provider.videoModel("bytedance/seedance-2.0"),
      prompt: { text: "Animate", image: new Uint8Array([137, 80, 78, 71]) }, webhook, maxRetries: 0 }),
      error => error.message === "fixture factory failure" || (error.code === "url_invalid" && error.path === "webhook_url"));
    assert.equal(calls.length, 0);
  }
});

test("AI SDK rejected webhook waiting does not resubmit or cancel the remote job", async () => {
  const { provider, calls } = fixture("video/mp4");
  await assert.rejects(() => generateVideo({ model: provider.videoModel("bytedance/seedance-2.0"), prompt: "Animate", maxRetries: 0,
    webhook: async () => ({ url: "https://example.com/hook", received: Promise.reject(new Error("fixture receiver failure")) }),
  }), /fixture receiver failure/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/v1/videos/generations");
});


test("AI SDK first-frame video preserves absent text without inventing a prompt", async () => {
 const { provider, calls } = fixture("video/mp4");
 await startVideo({model:provider.videoModel("google/veo-3.1-generate-001"), prompt:{image:"https://example.com/first.png"}, maxRetries:0});
 assert.equal(calls.length,1); assert.equal(calls[0].body.input.prompt, "");
 assert.deepEqual(calls[0].body.input.references,[{role:"first_frame",url:"https://example.com/first.png"}]);
 const { validateGeneration } = await import("../dist/shared/standard.js");
 const request = {model:"google/veo-3.1-generate-001", input:{type:"image",references:[{role:"first_frame",url:"https://example.com/first.png"}]},parameters:{}};
 validateGeneration("generate_video",request,catalog);
 for (const invalid of [ {...request,input:{type:"text"}}, {...request,input:{...request.input,prompt:null}}, {...request,model:"google/veo-3.1-fast-generate-001"} ]) {
  assert.throws(()=>validateGeneration("generate_video",invalid,catalog),error=>error.code==="prompt_required");
 }
 assert.equal(Object.hasOwn(request.input,"prompt"),false);
});


test("adaptive video ratio follows the supplied input-mode contract and native override", async () => {
  const { validateGeneration } = await import("../dist/shared/standard.js");
  for (const source of ["provider", "client", "explicit", "unknown"]) {
    const calls = [];
    const client = createYirClient(async request => {
      if (source !== "unknown") validateGeneration("generate_video", request.body, catalog);
      calls.push(request);
      return { id: "42", status: "queued", created_at: 1 };
    }, source === "client" ? catalog : undefined);
    const provider = createYirAIProvider({ client, ...(source === "provider" ? { modelContracts: catalog } : {}) });
    const parameters = { duration: "auto", ...(source === "explicit" ? { aspect_ratio: "auto" } : {}) };
    const original = structuredClone(parameters);
    await startVideo({ model: provider.videoModel("bytedance/seedance-2.5"), prompt: "Edit the scene", maxRetries: 0,
      aspectRatio: "adaptive", inputReferences: [{ data: "https://example.com/video.mp4", mediaType: "video/mp4" }],
      providerOptions: { yir: { parameters } } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.parameters.aspect_ratio, source === "unknown" ? "adaptive" : "auto");
    assert.equal(calls[0].body.parameters.duration, "auto");
    assert.deepEqual(parameters, original);
  }
});

test("adaptive ratio mapping respects aliases, media modes and conflicts before uploading", async () => {
  const modelContract = catalog.models.find(model => model.id === "bytedance/seedance-2.5");
  const { provider, calls } = fixture("video/mp4");
  const model = provider.videoModel(modelContract.aliases[0]);
  await startVideo({ model, prompt: { text: "Animate", image: "https://example.com/first.png" }, aspectRatio: "adaptive", maxRetries: 0 });
  assert.equal(calls[0].body.parameters.aspect_ratio, "auto");
  await startVideo({ model, prompt: "Animate", aspectRatio: "adaptive", maxRetries: 0 });
  assert.equal(calls[1].body.parameters.aspect_ratio, "adaptive");
  await startVideo({ model, prompt: { text: "Animate", image: "https://example.com/first.png" }, maxRetries: 0 });
  assert.equal(Object.hasOwn(calls[2].body.parameters, "aspect_ratio"), false);
  for (const [aspectRatio, aspect_ratio] of [["adaptive", "16:9"], ["16:9", "auto"]]) {
    await assert.rejects(() => model.doStart({ prompt: "Animate", n: 1, aspectRatio,
      image: { type: "file", data: new Uint8Array([1]), mediaType: "image/png" },
      providerOptions: { yir: { parameters: { aspect_ratio } } } }), error => error.code === "parameter_conflict");
  }
  assert.equal(calls.length, 3);
});


test("combined video settings preserve media roles, omitted text, native tier and exact dimensions", async () => {
  const cases = [
    { model: "google/veo-3.1-generate-001", call: { prompt: { image: "https://example.com/first.png" }, fps: 24 },
      native: { resolution: "720p" }, parameters: { resolution: "720p", n: 1, fps: 24 }, mode: "image", roles: ["first_frame"], prompt: "" },
    { model: "bytedance/seedance-2.5", call: { prompt: "Edit", aspectRatio: "adaptive", generateAudio: false,
        inputReferences: [{ data: "https://example.com/reference.mp4", mediaType: "video/mp4" }] },
      native: { duration: "auto", resolution: "480p" }, parameters: { duration: "auto", resolution: "480p", n: 1, generate_audio: false, aspect_ratio: "auto" },
      mode: "reference", roles: ["reference_video"], prompt: "Edit" },
    { model: "bytedance/seedance-2.0", call: { prompt: "Animate", fps: 30, resolution: "1280x720", aspectRatio: "16:9", duration: 5, seed: 0,
        frameImages: [{ frameType: "first_frame", image: "https://example.com/first.png" }, { frameType: "last_frame", image: "https://example.com/last.png" }] },
      native: {}, parameters: { n: 1, fps: 30, size: "1280x720", aspect_ratio: "16:9", duration: 5, seed: 0 }, mode: "image", roles: ["first_frame", "last_frame"], prompt: "Animate" },
  ];
  for (const entry of cases) {
    const { provider, calls } = fixture("video/mp4");
    // Mapping coverage only: unsupported combinations must reach authoritative Gateway validation unchanged.
    await startVideo({ model: provider.videoModel(entry.model), ...entry.call, maxRetries: 0,
      providerOptions: { yir: { parameters: entry.native } } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.parameters, entry.parameters);
    assert.equal(calls[0].body.input.type, entry.mode);
    assert.equal(calls[0].body.input.prompt, entry.prompt);
    assert.deepEqual(calls[0].body.input.references.map(reference => reference.role), entry.roles);
  }
});

test("combined image dimensions and ratio reach the Gateway without rewriting conflicting intent", async () => {
  for (const aspectRatio of ["1:1", "16:9"]) {
    const { provider, calls } = fixture();
    await generateImage({ model: provider.imageModel("bytedance/seedream-5.0-pro"), prompt: "Scene", size: "1024x1024", aspectRatio, maxRetries: 0 });
    assert.deepEqual(calls[0].body.parameters, { n: 1, size: "1024x1024", aspect_ratio: aspectRatio });
  }
});


test("a stale ratio catalog cannot create a conflict between matching explicit options", async () => {
  for (const mode of ["image", "reference"]) {
    const { provider, calls } = fixture("video/mp4");
    const parameters = { aspect_ratio: "adaptive" };
    await startVideo({ model: provider.videoModel("bytedance/seedance-2.5"), prompt: "Animate", aspectRatio: "adaptive", maxRetries: 0,
      ...(mode === "image" ? { frameImages: [{ frameType: "first_frame", image: "https://example.com/first.png" }] }
        : { inputReferences: [{ data: "https://example.com/ref.mp4", mediaType: "video/mp4" }] }),
      providerOptions: { yir: { parameters } } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.parameters.aspect_ratio, "adaptive");
    assert.deepEqual(parameters, { aspect_ratio: "adaptive" });
  }
});
