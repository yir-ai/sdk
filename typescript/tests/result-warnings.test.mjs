import assert from "node:assert/strict";
import test from "node:test";
import { createNodeYirClient } from "../dist/server/index.js";

test("HTTP parsing and polling retain optional result warnings without retrying generation", async () => {
  for (const availability of ["available", "expired"]) for (const warned of [false, true]) {
    const result = { availability, ...(availability === "available" ? { files: [{ url: "https://example.com/video.mp4", media_type: "video/mp4", expires_at: 1900000000 }] } : {}), ...(warned ? { warnings: ["additional_results_unavailable"] } : {}) };
    const payload = { object: "job", id: "1", model: "bytedance/seedance-2.0", status: "succeeded", result, error: null, created_at: 1 };
    let statusCalls = 0;
    let detailCalls = 0;
    const client = createNodeYirClient({ apiKey: "fixture", baseURL: "https://example.com", fetch: async (url, options) => {
      assert.equal(options.method, "GET");
      const pathname = new URL(url).pathname;
      if (pathname === "/v1/jobs/1/status") {
        statusCalls++;
        return new Response(JSON.stringify({ id: "1", status: "succeeded", error: null }), { headers: { "content-type": "application/json" } });
      }
      if (pathname === "/v1/jobs/1") {
        detailCalls++;
        return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected url: ${url}`);
    } });
    assert.deepEqual(await client.getJob("1"), payload);
    assert.deepEqual(await client.waitForJob("1"), payload);
    assert.equal(statusCalls, 1, "wait should poll status once");
    assert.equal(detailCalls, 2, "getJob once and terminal detail read once");
  }
});
