import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createYirClient, DEFAULT_USER_AGENT, YIR_ERROR_CODES } from "../dist/index.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("stable error codes match the OpenAPI enum in both SDKs", async () => {
  const spec = JSON.parse(await read("../../spec/openapi.json"));
  const expected = spec.components.schemas.Error.properties.code.enum;
  assert.deepEqual([...YIR_ERROR_CODES], expected);
  const goSource = await read("../../go/client.go");
  const goCodes = [...goSource.matchAll(/^\tErrCode\w+\s*=\s*"(YIR_[A-Z_]+)"$/gm)].map(match => match[1]);
  assert.deepEqual(goCodes, expected);
});

test("default User-Agent reports the package version", async () => {
  const { version } = JSON.parse(await read("../package.json"));
  assert.equal(DEFAULT_USER_AGENT, `@yir-ai/sdk/${version}`);
});

test("cancelJob forwards the abort signal and rejects an aborted signal before sending", async () => {
  const calls = [];
  const client = createYirClient(async request => {
    calls.push(request);
    return { id: "7001", object: "job", status: "cancelled", model: "openai/gpt-image-2", error: null, created_at: 1 };
  });
  const controller = new AbortController();
  await client.cancelJob("7001", { signal: controller.signal });
  assert.equal(calls[0].signal, controller.signal);
  controller.abort();
  assert.throws(() => client.cancelJob("7002", { signal: controller.signal }));
  assert.equal(calls.length, 1);
});

test("cancelJob rejects a response that is not the cancelled job", async () => {
  for (const response of [{}, null, { id: "9999", status: "cancelled" }, { id: "7001", status: "" }, { id: "7001", status: 7 }]) {
    const client = createYirClient(async () => response);
    await assert.rejects(client.cancelJob("7001"), /response_invalid/);
  }
});
