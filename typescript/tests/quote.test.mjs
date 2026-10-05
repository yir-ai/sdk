import assert from "node:assert/strict";
import test from "node:test";
import { createYirClient } from "../dist/index.js";
import { quoteFixture } from "./quote-fixture.mjs";
import { catalog } from "./catalog-fixture.mjs";

const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "test" }, parameters: {} };
const read = value => createYirClient(async () => value).quoteImage(request);

test("Quote ignores deprecated compatibility fields the Gateway still returns", async () => {
  const value = { ...quoteFixture(request), max: { kind: "fixed", amount: "0.02" },
    has_verifiable_upper_bound: false, single_attempt_upper_bound: null,
    supply: { available: true, requires_max_cost: false, issues: [] } };
  assert.deepEqual(await read(value), value);
  assert.deepEqual(await read(quoteFixture(request)), quoteFixture(request));
});

test("Official output estimate carries assumptions without authorizing a budget", async () => {
  const value = { ...quoteFixture(request),
    official: { kind: "estimate", amount: "0.042390", estimate: { scope: "output_only", output_tokens: 1413 } } };
  assert.deepEqual(await read(value), value);
  for (const estimate of [null, {}, { scope: "output_only", output_tokens: 0 }, { scope: "output_only", output_tokens: 1.5 },
    { scope: "output_only", output_tokens: 1, output_megapixels: 1 }]) {
    await assert.rejects(read({ ...value, official: { ...value.official, estimate } }), /quote_response_invalid/);
  }
  // Newer scopes and usage metrics are data, not a reason to drop the quote.
  const newer = { ...value, official: { ...value.official, estimate: { scope: "complete", output_seconds: 8 } } };
  assert.deepEqual(await read(newer), newer);
});

test("Quote accepts newer price kinds and supply issues while keeping amounts strict", async () => {
  const value = { ...quoteFixture(request), official: { kind: "tiered", amount: "0.030000", reason: "volume" } };
  assert.deepEqual(await read(value), value);
  await assert.rejects(read({ ...value, official: { kind: "tiered", amount: "1e-2" } }), /quote_response_invalid/);
  await assert.rejects(read({ ...value, official: { kind: "tiered", amount: 0.03 } }), /quote_response_invalid/);
  const omitted = { ...value, official: { kind: "tiered", reason: "volume" } };
  assert.deepEqual(await read(omitted), omitted);
  const unavailable = { ...quoteFixture(request),
    supply: { available: false, issues: ["region_restricted"] },
    primary: { kind: "unavailable", amount: null, reason: "region_restricted" } };
  assert.deepEqual(await read(unavailable), unavailable);
  await assert.rejects(read({ ...unavailable, primary: { kind: "fixed", amount: "0.05" } }), /quote_response_invalid/);
  await assert.rejects(read({ ...unavailable, supply: { ...unavailable.supply, issues: [] } }), /quote_response_invalid/);
});

test("Quote rejects malformed or mismatched responses without exposing response contents", async () => {
  for (const patch of [null, {}, { model: " " }, { operation: "generate_video" },
    { input_mode: "image" }, { parameters: null }, { expires_at: 0 },
    { primary: { kind: "fixed", amount: 0.02 } },
    { primary: { kind: "fixed", amount: "1e-2" } },
    { primary: { kind: "fixed", amount: "0.02", reason: "secret" } },
    { official: { kind: "unavailable", amount: "0", reason: "unknown" } },
    { official: { kind: "unavailable", amount: null, reason: " " } },
    { official: { kind: "estimate", amount: "0.05" } },
    { supply: { available: true } }]) {
    const value = patch === null ? null : Object.keys(patch).length ? { ...quoteFixture(request), ...patch } : {};
    await assert.rejects(read(value), { message: "quote_response_invalid" });
  }
});

test("Quote keeps amounts strict and does not cap official reference prices", async () => {
  const value = quoteFixture(request);
  value.primary.amount = "000.0200";
  value.official.amount = "0.010000000000000001";
  assert.deepEqual(await read(value), value);
  value.primary.amount = "0.02.0";
  await assert.rejects(read(value), /quote_response_invalid/);
});

// A quote in another currency fails closed with its own error so callers can
// tell it apart from a malformed response.
test("Quote reports an unsupported currency separately", async () => {
  await assert.rejects(read({ ...quoteFixture(request), currency: "EUR" }), { message: "quote_currency_unsupported" });
  for (const currency of ["", " ", undefined, 840]) {
    await assert.rejects(read({ ...quoteFixture(request), currency }), { message: "quote_response_invalid" });
  }
  const batch = createYirClient(async () => ({ object: "quote_batch", request_id: "test",
    data: [{ index: 0, quote: { ...quoteFixture(request), currency: "EUR" } }] }));
  await assert.rejects(batch.quoteBatch([{ operation: "generate_image", request }]), { message: "quote_currency_unsupported" });
});

test("Quote compares models through the catalog and accepts a canonical echo for an alias", async () => {
  const aliasRequest = { ...request, model: "gpt-image-2" };
  const echoed = { ...quoteFixture(aliasRequest), model: "openai/gpt-image-2" };
  assert.equal((await createYirClient(async () => echoed).quoteImage(aliasRequest)).model, "openai/gpt-image-2");
  assert.equal((await createYirClient(async () => echoed, catalog).quoteImage(aliasRequest)).model, "openai/gpt-image-2");
  const other = { ...quoteFixture(request), model: "openai/gpt-image-1" };
  await assert.rejects(createYirClient(async () => other, catalog).quoteImage(request), { message: "quote_response_invalid" });
  const unknown = { ...quoteFixture(request), model: "future/model" };
  await assert.rejects(createYirClient(async () => unknown, catalog).quoteImage(request), { message: "quote_response_invalid" });
});
