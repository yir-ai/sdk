import assert from "node:assert/strict";
import test from "node:test";
import { createYirClient } from "../dist/index.js";
import { quoteFixture } from "./quote-fixture.mjs";

const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "test" }, parameters: {} };
const read = value => createYirClient(async () => value).quoteImage(request);

test("Quote accepts server-authorized supply without an upper bound or required cap", async () => {
  const value = { ...quoteFixture(request), has_verifiable_upper_bound: false, single_attempt_upper_bound: null,
    supply: { available: true, requires_max_cost: false, issues: [] } };
  assert.deepEqual(await read(value), value);
  await assert.rejects(read({ ...value, single_attempt_upper_bound: "0.05" }), /quote_response_invalid/);
});

test("Official output estimate carries assumptions without authorizing a budget", async () => {
  const value = { ...quoteFixture(request), has_verifiable_upper_bound: false, single_attempt_upper_bound: null,
    supply: { available: true, requires_max_cost: true, issues: [] },
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
  const unavailable = { ...quoteFixture(request), has_verifiable_upper_bound: false, single_attempt_upper_bound: null,
    supply: { available: false, requires_max_cost: false, issues: ["region_restricted"] },
    primary: { kind: "unavailable", amount: null, reason: "region_restricted" },
    max: { kind: "unavailable", amount: null, reason: "region_restricted" } };
  assert.deepEqual(await read(unavailable), unavailable);
  await assert.rejects(read({ ...unavailable, max: { kind: "fixed", amount: "0.05" } }), /quote_response_invalid/);
  await assert.rejects(read({ ...unavailable, supply: { ...unavailable.supply, issues: [] } }), /quote_response_invalid/);
});

test("Quote rejects malformed or mismatched responses without exposing response contents", async () => {
  for (const patch of [null, {}, { model: "future/model" }, { operation: "generate_video" },
    { input_mode: "image" }, { parameters: null }, { expires_at: 0 },
    { primary: { kind: "fixed", amount: 0.02 } },
    { primary: { kind: "fixed", amount: "1e-2" } },
    { primary: { kind: "fixed", amount: "0.02", reason: "secret" } },
    { max: { kind: "unavailable", amount: "0", reason: "unknown" } },
    { max: { kind: "unavailable", amount: null, reason: " " } },
    { max: { kind: "estimate", amount: "0.05" } },
    { has_verifiable_upper_bound: "true" }, { has_verifiable_upper_bound: false },
    { single_attempt_upper_bound: "0.01" }]) {
    const value = patch === null ? null : Object.keys(patch).length ? { ...quoteFixture(request), ...patch } : {};
    await assert.rejects(read(value), { message: "quote_response_invalid" });
  }
});

test("Quote compares exact decimals and does not cap official reference prices", async () => {
  const value = quoteFixture(request);
  value.primary.amount = "000.050000000000000001";
  await assert.rejects(read(value), /quote_response_invalid/);
  value.primary.amount = "000.0200";
  assert.deepEqual(await read(value), value);
  value.max = { kind: "unavailable", amount: null, reason: "candidate_price_unavailable" };
  value.single_attempt_upper_bound = "0.019999999999999999";
  await assert.rejects(read(value), /quote_response_invalid/);
  value.has_verifiable_upper_bound = false;
  value.single_attempt_upper_bound = null;
  value.supply.requires_max_cost = true;
  assert.deepEqual(await read(value), value);
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
