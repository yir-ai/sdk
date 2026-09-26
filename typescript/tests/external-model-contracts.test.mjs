import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createYirClient, getModelContract } from "../dist/index.js";
import { findModelContract, parseModelContractCatalog, parseModelContractDetail, modelContractPath, validateModelParameters } from "../dist/frontend.js";
import { quoteFixture } from "./quote-fixture.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const future = { ...structuredClone(getModelContract("openai/gpt-image-2")), id: "future/new-image", aliases: [] };
const response = {
  schema_version: "v1",
  schema_ref: "./standard-openapi.json#/components/schemas/ModelContractCatalog",
  version: "a".repeat(64),
  models: [future],
};
const request = {
  model: future.id,
  input: { type: "text", prompt: "A future image" },
  parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
};

test("a model absent from the bundled SDK reaches Quote; current API data validates its parameters", async () => {
  const catalog = parseModelContractCatalog(response);
  assert.equal(findModelContract(catalog, future.id)?.id, future.id);
  assert.throws(() => validateModelParameters(future.id, "generate_image", "text", { resolution: "unknown" }, catalog),
    error => error.code === "parameter_value");
  let sent = 0;
  const transport = async call => { sent++; return quoteFixture(call.body); };
  await createYirClient(transport).quoteImage(request);
  assert.equal(sent, 1);
  const strict = createYirClient(transport, catalog);
  assert.throws(() => strict.quoteImage({ ...request, parameters: { resolution: "unknown" } }),
    error => error.code === "parameter_value");
  assert.equal(sent, 1);
  await strict.quoteImage(request);
  assert.equal(sent, 2);
});

test("SDK reads the expanded API catalog and rejects unknown rule semantics", async () => {
  const calls = [];
  const client = createYirClient(async call => { calls.push(call); return response; });
  const catalog = await client.getModelContracts();
  assert.equal(catalog.version, response.version);
  assert.deepEqual(calls.map(call => [call.method, call.path]), [["GET", "/v1/models?include=parameters"]]);
  const changed = structuredClone(response);
  changed.models[0].operations[0].input_constraints.text.new_requirement = true;
  assert.throws(() => parseModelContractCatalog(changed), /model_contract_semantics_unsupported/);
  assert.throws(() => parseModelContractCatalog({ ...response, schema_version: "v2" }), /model_contract_schema_unsupported/);
});

test("SDK reads one versioned model contract and checks the requested identity", async () => {
  const detail = {
    schema_version: response.schema_version, schema_ref: response.schema_ref,
    version: response.version, model: future,
  };
  const calls = [];
  const client = createYirClient(async call => { calls.push(call); return detail; });
  const result = await client.getModelContract(future.id);
  assert.equal(result.version, response.version);
  assert.equal(result.model.id, future.id);
  assert.deepEqual(calls.map(call => [call.method, call.path]), [["GET", "/v1/models/future/new-image?view=contract"]]);
  assert.throws(() => modelContractPath("future/new-image?view=pricing"), /model_contract_request_invalid/);
  await assert.rejects(client.getModelContract("new-image"), /model_contract_request_invalid/);
  assert.throws(() => parseModelContractDetail(detail, "private/other"), /model_contract_invalid/);
});

test("Quote accepts a published alias echoed by the Gateway or its canonical ID", async () => {
  const alias = "new-image";
  const catalog = parseModelContractCatalog({ ...response, models: [{ ...future, aliases: [alias] }] });
  const aliasedRequest = { ...request, model: alias };
  for (const returned of [alias, future.id]) {
    const client = createYirClient(async call => ({ ...quoteFixture(call.body), model: returned }), catalog);
    assert.equal((await client.quoteImage(aliasedRequest)).model, returned);
  }
  const wrong = createYirClient(async call => ({ ...quoteFixture(call.body), model: "other/model" }), catalog);
  await assert.rejects(wrong.quoteImage(aliasedRequest), /quote_response_invalid/);
});

test("a cached contract does not block a newly published model quote", async () => {
  const staleCatalog = parseModelContractCatalog({ ...response, models: [getModelContract("openai/gpt-image-2")] });
  const client = createYirClient(async call => ({
    object: "quote_batch", request_id: "test", data: [{ index: 0, quote: quoteFixture(call.body.requests[0].request) }],
  }), staleCatalog);
  const result = await client.quoteBatch([{ operation: "generate_image", request }]);
  assert.equal(result.data[0].quote.model, future.id);
});

test("generator writes a customer models.ts from the API without changing the SDK", async () => {
  const server = createServer((incoming, outgoing) => {
    assert.equal(incoming.url, "/gateway/v1/models?include=parameters");
    assert.equal(incoming.headers.authorization, "Bearer test-key");
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const target = path.resolve(packageRoot, "../.tmp/scratch", `models-test-${process.pid}.ts`);
  try {
    const child = spawn(process.execPath, ["scripts/generate-models.mjs", "--output", target, "--base-url", `http://127.0.0.1:${address.port}/gateway`], {
      cwd: packageRoot,
      env: { ...process.env, YIR_API_KEY: "test-key" },
      stdio: "pipe",
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(exitCode, 0);
    const generated = await readFile(target, "utf8");
    assert.match(generated, /import type \{ ModelContractCatalog \} from "@yir-ai\/sdk\/frontend"/);
    assert.match(generated, /future\/new-image/);
    assert.match(generated, /as const satisfies ModelContractCatalog/);
  } finally {
    server.close();
    await unlink(target).catch(() => {});
  }
});
