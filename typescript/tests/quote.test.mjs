import assert from "node:assert/strict";
import test from "node:test";
import { createYirClient } from "../dist/index.js";
import { quoteFixture } from "./quote-fixture.mjs";

const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "test" }, parameters: {} };
const read = value => createYirClient(async () => value).quoteImage(request);

test("Official output estimate carries assumptions without authorizing a budget", async () => {
  const value = { ...quoteFixture(request), has_verifiable_upper_bound: false, single_attempt_upper_bound: null,
    official: { kind: "estimate", amount: "0.042390", estimate: { scope: "output_only", output_tokens: 1413 } } };
  assert.deepEqual(await read(value), value);
  for (const estimate of [null, {}, { scope: "complete", output_tokens: 1413 }, { scope: "output_only", output_tokens: 0 }, { scope: "output_only", output_tokens: 1.5 }]) {
    await assert.rejects(read({ ...value, official: { ...value.official, estimate } }), /quote_response_invalid/);
  }
});

test("Quote rejects malformed or mismatched responses without exposing response contents", async () => {
  for (const patch of [null, {}, { model: "future/model" }, { operation: "generate_video" },
    { input_mode: "image" }, { currency: "EUR" }, { parameters: null }, { expires_at: 0 },
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
  assert.deepEqual(await read(value), value);
});
