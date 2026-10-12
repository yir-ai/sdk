import assert from "node:assert/strict";
import test from "node:test";
import { createGateway, generateImage, experimental_startVideo as startVideo } from "ai";
import { createYirAIProvider } from "../dist/server/vercel.js";
import { createYirClient } from "../dist/server/client.js";
import { catalog } from "./catalog-fixture.mjs";

function providers() {
  const gatewayCalls = [], yirCalls = [];
  const image = "iVBORw0KGgo=";
  const gateway = createGateway({ apiKey: "test-key", fetch: async (url, init) => {
    gatewayCalls.push(JSON.parse(init.body));
    return Response.json(String(url).endsWith("/start") ? { operation: { id: "gw-42" } } : { images: [image] });
  } });
  const yir = createYirAIProvider({ modelContracts: catalog, client: createYirClient(async call => {
    yirCalls.push(call.body);
    return { id: "42", status: "succeeded", created_at: 1, result: { availability: "available", files: [{ url: "https://example.com/result.png", media_type: "image/png" }] } };
  }), fetch: async () => new Response(Buffer.from(image, "base64")) });
  return { gateway, yir, gatewayCalls, yirCalls };
}

for (const model of ["bytedance/seedream-5.0-pro", "openai/gpt-image-2"]) {
  test("switch image Provider only: " + model, async () => {
    const { gateway, yir, gatewayCalls, yirCalls } = providers();
    const call = { prompt: "A paper boat", aspectRatio: "1:1", n: 1, maxRetries: 0 };
    for (const provider of [gateway, yir]) await generateImage({ model: provider.imageModel(model), ...call });
    assert.equal(gatewayCalls.length, 1);
    assert.equal(yirCalls.length, 1);
    assert.equal(yirCalls[0].input.prompt, gatewayCalls[0].prompt);
    assert.equal(yirCalls[0].parameters.aspect_ratio, gatewayCalls[0].aspectRatio);
    assert.equal(yirCalls[0].parameters.n, gatewayCalls[0].n);
  });
}

for (const [name, model, call] of [
  ["exact 1080p text", "bytedance/seedance-2.5", { prompt: "A paper boat", duration: 4, aspectRatio: "16:9", resolution: "1920x1080" }],
  ["text", "google/veo-3.1-generate-001", { prompt: "A paper boat", duration: 8, aspectRatio: "16:9", fps: 24, generateAudio: true }],
  ["first frame", "google/veo-3.1-generate-001", { prompt: { text: "Animate", image: "https://example.com/first.png" }, duration: 8, generateAudio: true }],
  ["reference image URL", "bytedance/seedance-2.5", { prompt: "Animate", duration: 4, aspectRatio: "adaptive", inputReferences: ["https://example.com/reference.png"] }],
  ["reference video URL", "bytedance/seedance-2.5", { prompt: "Edit", duration: 6, aspectRatio: "adaptive", inputReferences: [{ data: "https://example.com/reference.mp4", mediaType: "video/mp4" }] }],
]) {
  test("switch video Provider only: " + name, async () => {
    const { gateway, yir, gatewayCalls, yirCalls } = providers();
    for (const provider of [gateway, yir]) await startVideo({ model: provider.videoModel(model), ...call, maxRetries: 0 });
    const source = gatewayCalls[0], target = yirCalls[0];
    assert.equal(gatewayCalls.length, 1);
    assert.equal(yirCalls.length, 1);
    assert.equal(target.input.prompt, source.prompt);
    for (const [standard, native] of [["resolution", "size"], ["duration", "duration"], ["fps", "fps"], ["generateAudio", "generate_audio"], ["n", "n"]]) {
      assert.equal(target.parameters[native], source[standard]);
    }
    assert.equal(target.parameters.aspect_ratio, source.aspectRatio === "adaptive" ? "auto" : source.aspectRatio);
    if (source.inputReferences?.length) {
      assert.equal(target.input.references[0].url, source.inputReferences[0].url);
      assert.equal(target.input.references[0].role, name.includes("video URL") ? "reference_video" : "reference_image");
    }
  });
}


test("untyped URL fallback does not accept unsafe URLs or unsupported explicit media types", async () => {
  for (const input of [
    { type: "url", url: "http://example.com/ref.png" },
    { type: "url", url: "https://example.com/ref.txt", mediaType: "text/plain" },
    { type: "file", data: new Uint8Array([1]) },
  ]) {
    const { yir, yirCalls } = providers();
    await assert.rejects(() => yir.videoModel("bytedance/seedance-2.5").doStart({
      prompt: "Animate", n: 1, inputReferences: [input], providerOptions: {},
    }));
    assert.equal(yirCalls.length, 0);
  }
});
