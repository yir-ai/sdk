import assert from "node:assert/strict";
import test from "node:test";
import { createYirClient, validateGeneration } from "./catalog-fixture.mjs";
import { createYirClient as createBareClient, createNodeYirClient, validateGeneration as validateProtocol, YirSDKValidationError } from "../dist/index.js";

const quote3D = (request, overrides = {}) => ({
  supply: { available: true, issues: [] },
  object: "quote", model: request.model.includes("/") ? request.model : "tripo/tripo-h3.1", operation: "generate_3d", input_mode: request.input.type,
  // A 3D echo carries n and the model's texture, pbr, face_limit and topology, no resolution or aspect_ratio.
  parameters: { n: 1, texture: "standard", pbr: true, topology: "triangle" },
  currency: "USD", expires_at: 1900000000,
  primary: { kind: "fixed", amount: "0.20" },
  official: { kind: "fixed", amount: "0.20" },
  ...overrides,
});

const text = { model: "tripo-h3.1", input: { type: "text", prompt: "A weathered wooden armchair" }, parameters: { texture: "standard", pbr: true } };
const image = (model, references = [{ role: "reference_image", url: "https://example.com/chair.png" }]) => ({ model, input: { type: "image", references } });
const views = (...roles) => roles.map(role => ({ role, url: `https://example.com/${role}.png` }));
const multiview = (model, references) => ({ model, input: { type: "multiview", references } });
const rejects = (body, code, path) => error => error instanceof YirSDKValidationError && error.code === code && error.path === path;

test("3D Quote and Submit use the 3D paths and validate the 3D echo", async () => {
  const calls = [];
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path.endsWith("/quotes")) return quote3D(request.body);
    return { id: "7201", object: "job", status: "queued", model: "tripo/tripo-h3.1", error: null, created_at: 1 };
  });
  const quote = await client.quote3D(text);
  assert.equal(quote.operation, "generate_3d");
  assert.equal(quote.parameters.resolution, undefined);
  const submit = { ...text, webhook_url: "https://example.com/webhooks/yir", max_cost: "0.30" };
  await client.submit3D(submit, "3d-7201");
  // Parameters are optional; omitted ones take the model defaults.
  await client.quote3D(image("tencent/hunyuan-3d-3.1-pro"));
  assert.deepEqual(calls.map(call => [call.method, call.path]), [
    ["POST", "/v1/3d/quotes"], ["POST", "/v1/3d/generations"], ["POST", "/v1/3d/quotes"],
  ]);
  assert.deepEqual(calls[0].body, text);
  assert.deepEqual(calls[1].headers, { "Idempotency-Key": "3d-7201" });
  assert.deepEqual(calls[1].body, submit);
  assert.throws(() => client.submit3D(text, " "), /idempotency_key_invalid/);
  for (const overrides of [{ operation: "generate_image" }, { input_mode: "image" }]) {
    const wrong = createYirClient(async request => quote3D(request.body, overrides));
    await assert.rejects(wrong.quote3D(text), /quote_response_invalid/);
  }
});

test("a 3D quoteBatch item and a glb result with faces", async () => {
  const client = createYirClient(async request => {
    if (request.path === "/v1/quotes") return { object: "quote_batch", request_id: "req_3d", data: [{ index: 0, quote: quote3D(request.body.requests[0].request) }] };
    return {
      id: "7202", object: "job", status: "succeeded", model: "tripo/tripo-h3.1", error: null, created_at: 1,
      result: { availability: "available", files: [{ url: "https://cdn.example.com/a.glb", media_type: "model/gltf-binary", faces: 48210, expires_at: 2 }] },
    };
  });
  const batch = await client.quoteBatch([{ operation: "generate_3d", request: text }]);
  assert.equal(batch.data[0].quote.operation, "generate_3d");
  const job = await client.getJob("7202");
  assert.equal(job.result.files[0].faces, 48210);
  assert.equal(job.result.files[0].media_type, "model/gltf-binary");
});

test("3D input modes and values follow the model contract", () => {
  const valid = [
    text,
    { model: "tripo/tripo-h3.1", input: { type: "text", prompt: "A teapot" }, parameters: { texture: "none", face_limit: 20000 } },
    image("microsoft/trellis-2"),
    { ...image("meshy/meshy-7.1"), parameters: { texture: "standard", pbr: true, face_limit: 300000, topology: "quad", n: 1 } },
    multiview("tencent/hunyuan-3d-3.1-pro", views("front_view", "back_view")),
    multiview("tencent/hunyuan-3d-3.1-pro", views("front_view", "left_view", "back_view", "right_view")),
  ];
  for (const body of valid) {
    validateProtocol("generate_3d", body);
    validateGeneration("generate_3d", body);
  }
  const invalid = [
    // Input modes a model does not list.
    [{ model: "microsoft/trellis-2", input: { type: "text", prompt: "A chair" } }, "input_mode_invalid", "input.type"],
    [multiview("tripo/tripo-h3.1", views("front_view", "back_view")), "input_mode_invalid", "input.type"],
    [{ model: "tripo/tripo-h3.1", input: { type: "reference", prompt: "A chair", references: views("front_view") } }, "input_mode_invalid", "input.type"],
    // Image and multiview take no prompt; text needs one.
    [{ model: "tripo/tripo-h3.1", input: { type: "image", prompt: "A chair", references: views("reference_image") } }, "prompt_not_allowed", "input.prompt"],
    [{ model: "tripo/tripo-h3.1", input: { type: "text", prompt: " " } }, "prompt_required", "input.prompt"],
    // Reference counts and roles.
    [image("tripo/tripo-h3.1", views("reference_image", "reference_image")), "reference_count", "input.references"],
    [image("tripo/tripo-h3.1", views("front_view")), "reference_role_invalid", "input.references.0.role"],
    [multiview("tencent/hunyuan-3d-3.1-pro", views("front_view")), "reference_count", "input.references"],
    [multiview("tencent/hunyuan-3d-3.1-pro", views("left_view", "back_view")), "reference_role_required", "input.references"],
    [multiview("tencent/hunyuan-3d-3.1-pro", views("front_view", "back_view", "back_view")), "reference_role_count", "input.references"],
    // Values outside the contract.
    [{ ...image("tencent/hunyuan-3d-3.1-pro"), parameters: { texture: "hd" } }, "parameter_value", "parameters.texture"],
    [{ ...image("tripo/tripo-h3.1"), parameters: { topology: "quad" } }, "parameter_value", "parameters.topology"],
    [{ ...image("tencent/hunyuan-3d-3.1-pro"), parameters: { face_limit: 1000 } }, "parameter_range", "parameters.face_limit"],
    [{ ...image("microsoft/trellis-2"), parameters: { face_limit: 50000 } }, "parameter_unknown", "parameters.face_limit"],
    [{ ...image("microsoft/trellis-2"), parameters: { pbr: false } }, "parameter_value", "parameters.pbr"],
    [{ ...image("meshy/meshy-7.1"), parameters: { n: 2 } }, "parameter_value", "parameters.n"],
    // PBR needs a texture.
    [{ ...image("tripo/tripo-h3.1"), parameters: { texture: "none", pbr: true } }, "parameter_conflict", "parameters.pbr"],
  ];
  for (const [body, code, path] of invalid) {
    assert.throws(() => validateGeneration("generate_3d", body), rejects(body, code, path), `${body.model} ${code}`);
  }
});

test("without a catalog the 3D protocol rules still apply", () => {
  const invalid = [
    [{ model: "tripo-h3.1", input: { type: "reference", prompt: "A chair", references: views("front_view") } }, "input_mode_invalid", "input.type"],
    [{ model: "tripo-h3.1", input: { type: "image", prompt: "A chair", references: views("reference_image") } }, "prompt_not_allowed", "input.prompt"],
    [image("tripo-h3.1", []), "reference_count", "input.references"],
    [image("tripo-h3.1", views("reference_image", "reference_image")), "reference_count", "input.references"],
    [multiview("hunyuan-3d-3.1-pro", views("front_view")), "reference_count", "input.references"],
    [multiview("hunyuan-3d-3.1-pro", views("back_view", "left_view")), "reference_role_required", "input.references"],
    [multiview("hunyuan-3d-3.1-pro", views("front_view", "front_view")), "reference_role_count", "input.references"],
    [{ ...text, parameters: { texture: "none", pbr: true } }, "parameter_conflict", "parameters.pbr"],
    [{ ...text, parameters: { pbr: "yes" } }, "parameter_type", "parameters.pbr"],
    [{ ...text, parameters: { face_limit: 1.5 } }, "parameter_type", "parameters.face_limit"],
    [{ ...text, parameters: { texture: 1 } }, "parameter_type", "parameters.texture"],
  ];
  for (const [body, code, path] of invalid) {
    assert.throws(() => validateProtocol("generate_3d", body), rejects(body, code, path), `${code} ${path}`);
  }
  // Newer values are left to the Gateway without a catalog.
  validateProtocol("generate_3d", { ...text, parameters: { texture: "ultra", topology: "hex" } });
});

test("the Node transport retries 3D submits with the same key and body", async () => {
  const seen = [];
  const client = createNodeYirClient({
    apiKey: "test-key", baseURL: "https://gateway.example",
    fetch: async (url, init) => {
      seen.push({ url, key: new Headers(init.headers).get("Idempotency-Key"), body: init.body });
      if (seen.length === 1) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ id: "7203", object: "job", status: "queued" }), {
        status: 202, headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal((await client.submit3D(text, "3d-retry")).id, "7203");
  assert.deepEqual(seen.map(item => [item.url, item.key]), [
    ["https://gateway.example/v1/3d/generations", "3d-retry"], ["https://gateway.example/v1/3d/generations", "3d-retry"],
  ]);
  assert.equal(seen[0].body, seen[1].body);
});

test("demo mode refuses 3D submits without sending them", () => {
  let sent = 0;
  const client = createBareClient(async () => { sent++; return {}; }, undefined, { demo: true });
  assert.throws(() => client.submit3D(text, "3d-demo"), /demo_operation_unsupported/);
  assert.equal(sent, 0);
});
