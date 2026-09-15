import assert from "node:assert/strict";
import test from "node:test";
import { createNodeYirClient } from "../dist/server/index.js";

test("HTTP parsing and polling retain optional result warnings without retrying generation", async () => {
  for (const availability of ["available", "expired"]) for (const warned of [false, true]) {
    const result = { availability, ...(availability === "available" ? { files: [{ url: "https://example.com/video.mp4", media_type: "video/mp4", expires_at: 1900000000 }] } : {}), ...(warned ? { warnings: ["additional_results_unavailable"] } : {}) };
    const payload = { object: "job", id: "1", model: "bytedance/seedance-2.0", status: "succeeded", result, error: null, created_at: 1 };
    let calls = 0;
    const client = createNodeYirClient({ apiKey: "fixture", baseURL: "https://example.com", fetch: async (_url, options) => {
      calls++;
      assert.equal(options.method, "GET");
      return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
    } });
    assert.deepEqual(await client.getJob("1"), payload);
    assert.deepEqual(await client.waitForJob("1"), payload);
    assert.equal(calls, 2, "success warnings must not trigger resubmission or further polling");
  }
});
