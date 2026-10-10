import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

test("workerd supports SDK requests, uploads and AI SDK downloads without following redirects", async t => {
  const { outputFiles } = await build({
    stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), contents: `
      import { createNodeHttpTransport, uploadFile } from "./dist/index.js";
      import { createYirAIProvider } from "./dist/server/vercel.js";
      export default { async fetch(request) {
        const kind = new URL(request.url).pathname;
        try {
          let value;
          if (kind === "/upload") {
            const file = { object: "file", id: "file_11111111-1111-4111-8111-111111111111",
              name: "frame.png", media_type: "image/png", size: 1, status: "pending_upload",
              upload: { type: "multipart", expires_at: Math.floor(Date.now()/1000)+300,
                parts: [{ part_number: 1, size: 1, url: "https://storage.example/part" }] } };
            value = await uploadFile({ completeFile: async () => ({ ...file, status: "ready", upload: undefined }) }, file, new Blob(["x"]));
          } else if (kind === "/image") {
            const provider = createYirAIProvider({ client: { submitImage: async () => ({
              id: "42", status: "succeeded", created_at: 1786000000,
              result: { availability: "available", files: [{ url: "https://storage.example/result", media_type: "image/png" }] }
            }) } });
            const result = await provider.imageModel("openai/gpt-image-2").doGenerate({
              prompt: "fixture", n: 1, providerOptions: {}
            });
            value = { bytes: result.images[0].length };
          } else {
            const transport = createNodeHttpTransport({ apiKey: "fixture", baseURL: "https://gateway.example" });
            value = await transport({ method: "POST", path: "/generate", body: { model: "fixture" },
              ...(kind === "/manual" ? { redirect: "manual" } : {}) });
          }
          return Response.json({ value });
        } catch (error) { return Response.json({ error: error.message }); }
      }};
    ` },
    bundle: true, format: "esm", platform: "browser", write: false,
  });
  let status = 200;
  const calls = [];
  const mf = new Miniflare({
    cf: false, modules: true, script: outputFiles[0].text, compatibilityDate: "2026-07-30",
    outboundService: request => {
      calls.push({ url: request.url, method: request.method, authorization: request.headers.get("authorization") });
      if (status !== 200) return new Response("signed-url-must-stay-private", {
        status, headers: { Location: "https://never-follow.example/?signature=secret" },
      });
      return request.url.includes("gateway.example")
        ? Response.json({ ok: true }) : new Response("x");
    },
  });
  t.after(() => mf.dispose());
  for (const path of ["/api", "/upload", "/image"]) {
    for (const code of [200, 301, 302, 303, 307, 308]) {
      status = code; calls.length = 0;
      const result = await (await mf.dispatchFetch(`http://test${path}`)).json();
      if (code === 200) {
        assert.equal(result.error, undefined, `${path}: ${result.error}`);
        if (path === "/api") assert.deepEqual(result.value, { ok: true });
        if (path === "/upload") assert.equal(result.value.status, "ready");
        if (path === "/image") assert.equal(result.value.bytes, 1);
      } else {
        assert.equal(result.error, path === "/api" ? "unexpected_redirect"
          : path === "/upload" ? `upload_failed:${code}` : "yir_result_download_failed");
      }
      assert.equal(calls.length, 1, `${path}/${code} must never retry or follow a redirect`);
      assert.equal(calls[0].authorization, path === "/api" ? "Bearer fixture" : null);
      assert.ok(!calls[0].url.includes("never-follow"));
    }
  }
  status = 307; calls.length = 0;
  const manual = await (await mf.dispatchFetch("http://test/manual")).json();
  assert.deepEqual(manual.value, { status: 307, location: "https://never-follow.example/?signature=secret" });
  assert.equal(calls.length, 1);
});
