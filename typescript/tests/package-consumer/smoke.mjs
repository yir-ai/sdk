import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createYirClient } from "@yir-ai/sdk";
import { getModelContract, listModelContracts } from "@yir-ai/sdk/model-contracts";
import { createYirAIProvider } from "@yir-ai/sdk/vercel";
import { validateGeneration, validateModelParameters as validateParameters, getModelOperationContract } from "@yir-ai/sdk/browser";
import { parseModelContractCatalog, findModelContract } from '@yir-ai/sdk/frontend';
const catalog = parseModelContractCatalog({schema_version:'v1', schema_ref:'fixture', models:listModelContracts()});
const validateModelParameters = (...args) => validateParameters(...args, catalog);
assert.equal(findModelContract(catalog, 'openai/gpt-image-2').id, 'openai/gpt-image-2');
validateGeneration("generate_video", { model: "minimax/minimax-h3", input: { type: "reference", prompt: "fixture", references: [{ role: "reference_audio", url: "https://example.com/audio.mp3" }] }, parameters: {} });
import { createNodeYirClient } from "@yir-ai/sdk/server";

for (const availability of ["available", "expired"]) for (const warned of [false, true]) {
  const result = { availability, ...(availability === "available" ? { files: [{ url: "https://example.com/video.mp4", media_type: "video/mp4", expires_at: 1900000000 }] } : {}), ...(warned ? { warnings: ["additional_results_unavailable"] } : {}) };
  const payload = { object: "job", id: "1", status: "succeeded", result, error: null, created_at: 1 };
  let calls = 0;
  const installedClient = createNodeYirClient({ apiKey: "fixture", baseURL: "https://example.com", fetch: async (_url, options) => {
    calls++;
    assert.equal(options.method, "GET");
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  } });
  assert.deepEqual(await installedClient.waitForJob("1"), payload);
  assert.equal(calls, 2);
}

validateModelParameters("google/nano-banana-2", "generate_image", "text", { web_search: true, image_search: true });
validateModelParameters("bytedance/seedance-2.0", "generate_video", "text", { return_last_frame: true });
validateModelParameters("bytedance/seedance-2.0", "generate_video", "text", { aspect_ratio: "adaptive", return_last_frame: true });
assert.throws(() => validateModelParameters("google/nano-banana-2", "generate_image", "text", { return_last_frame: false }), { code: "parameter_unknown" });
for (const mode of ["text", "image"]) {
  validateModelParameters("google/nano-banana-pro", "generate_image", mode, { web_search: true });
  assert.throws(() => validateModelParameters("google/nano-banana-pro", "generate_image", mode, { image_search: false }), { code: "parameter_unknown" });
}
assert.equal(getModelOperationContract("bytedance/seedance-2", "generate_video", "reference").input_constraints.reference.reference_counts_by_role.reference_image.maximum, 9);

const consumer = path.dirname(fileURLToPath(import.meta.url));
for (const name of ["@yir-ai/sdk", "@yir-ai/sdk/model-contracts", "@yir-ai/sdk/vercel", "@yir-ai/sdk/frontend", "@yir-ai/sdk/server", "@yir-ai/sdk/browser", "@yir-ai/sdk/shared"]) {
  const resolved = fileURLToPath(import.meta.resolve(name));
  assert.ok(resolved.startsWith(path.join(consumer, "node_modules") + path.sep), "Entry must resolve from the installed archive");
  assert.ok(resolved.endsWith(".js"));
}
const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "test" }, parameters: {} };
const submissions = [];
const submittingClient = createNodeYirClient({ apiKey: "fixture", baseURL: "https://example.com", fetch: async (url, options) => {
  assert.equal(options.method, "POST");
  const key = new Headers(options.headers).get("Idempotency-Key");
  assert.ok(key?.trim(), "The installed SDK must supply a key when omitted by the caller");
  submissions.push({ url: String(url), key, body: JSON.parse(options.body) });
  return new Response(JSON.stringify({ object: "job", id: String(submissions.length), status: "queued", result: null, error: null, created_at: 1 }), { status: 202, headers: { "content-type": "application/json" } });
} });
await submittingClient.submitImage(request);
await submittingClient.submitImage(request);
assert.notEqual(submissions[0].key, submissions[1].key, "Separate calls must use separate generated identities");
const videoRequest = { model: "google/veo-3.1-fast", input: { type: "text", prompt: "test" }, parameters: {} };
await submittingClient.submitVideo(videoRequest);
assert.ok(submissions[2].url.endsWith("/v1/videos/generations"));
await submittingClient.submitImage(request, "saved-key");
await submittingClient.submitImage(request, "saved-key");
assert.equal(submissions[3].key, "saved-key");
assert.deepEqual(submissions[3], submissions[4], "Recovery must preserve the saved key and request on the wire");
assert.equal(submissions.length, 5, "Each invocation must issue exactly one Submit");
let unknownSubmits = 0;
const unknownClient = createNodeYirClient({ apiKey: "fixture", baseURL: "https://example.com", fetch: async () => {
  unknownSubmits++;
  throw new Error("fixture_unknown_submit");
} });
await assert.rejects(() => unknownClient.submitImage(request), /fixture_unknown_submit/);
assert.equal(unknownSubmits, 1, "An ambiguous outcome must not cause an implicit Submit retry");
let calls = 0;
const client = createYirClient(async () => {
  calls++;
  return { object: "quote", model: request.model, operation: "generate_image", input_mode: "text", parameters: {}, currency: "USD",
    primary: { kind: "fixed", amount: "0.02" }, max: { kind: "fixed", amount: "0.05" },
    official: { kind: "estimate", amount: "0.04239", estimate: { scope: "output_only", output_tokens: 1413 } },
    supply: { available: true, requires_max_cost: false, issues: [] }, has_verifiable_upper_bound: true, single_attempt_upper_bound: "0.05", expires_at: 1900000000 };
}, catalog);
assert.equal((await client.quoteImage(request)).official.estimate.scope, "output_only");
assert.throws(() => client.quoteImage({ ...request, parameters: { unknown_parameter: true } }), { code: "parameter_unknown" });
assert.equal(calls, 1, "Invalid parameters must fail inside the installed SDK before transport");
assert.equal(getModelContract(request.model).id, request.model);
assert.equal(createYirAIProvider({ client }).imageModel(request.model).specificationVersion, "v4");

assert.equal('getModelPrices' in client, false);
const browser = await import('@yir-ai/sdk/browser');
const shared = await import('@yir-ai/sdk/shared');
const server = await import('@yir-ai/sdk/server');
assert.equal(shared.getModelContract, getModelContract);
assert.equal(server.createYirClient, createYirClient);
assert.equal('createNodeYirClient' in browser, false);
