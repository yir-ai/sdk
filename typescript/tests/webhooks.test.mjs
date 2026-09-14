import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyWebhookSignature } from "../dist/index.js";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(sdkRoot, "..");
const vector = JSON.parse(fs.readFileSync(path.join(
  repositoryRoot,
  "spec/fixtures/contracts/yir-standard-webhook-signature-v1.json",
), "utf8"));
const encoder = new TextEncoder();

function verificationRequest(overrides = {}) {
  return {
    secret: vector.testOnlySecret,
    id: vector.id,
    timestamp: vector.timestamp,
    signature: vector.signature,
    rawBody: encoder.encode(vector.rawBody),
    now: Number(vector.timestamp),
    ...overrides,
  };
}

test("SDK verifies the shared Yir Standard webhook signature vector", async () => {
  assert.deepEqual(await verifyWebhookSignature(verificationRequest()), {
    valid: true,
    timestamp: Number(vector.timestamp),
  });
});

test("SDK rejects re-serialized or modified webhook bodies", async () => {
  const result = await verifyWebhookSignature(verificationRequest({
    rawBody: encoder.encode('{"status":"succeeded","id":"7001"}'),
  }));
  assert.deepEqual(result, { valid: false, reason: "invalid_signature" });
});

test("SDK rejects expired and future webhook timestamps", async () => {
  const timestamp = Number(vector.timestamp);
  assert.deepEqual(
    await verifyWebhookSignature(verificationRequest({ now: timestamp + 301 })),
    { valid: false, reason: "timestamp_outside_tolerance" },
  );
  assert.deepEqual(
    await verifyWebhookSignature(verificationRequest({ now: timestamp - 301 })),
    { valid: false, reason: "timestamp_outside_tolerance" },
  );
});

test("SDK rejects malformed headers and a rotated-away secret", async () => {
  assert.deepEqual(
    await verifyWebhookSignature(verificationRequest({ timestamp: "1785974442.0" })),
    { valid: false, reason: "invalid_timestamp" },
  );
  assert.deepEqual(
    await verifyWebhookSignature(verificationRequest({ signature: "" })),
    { valid: false, reason: "missing_header" },
  );
  assert.deepEqual(
    await verifyWebhookSignature(verificationRequest({
      secret: `yir_whsec_${"B".repeat(43)}`,
    })),
    { valid: false, reason: "invalid_signature" },
  );
});

test("SDK rejects invalid verification clock configuration", async () => {
  await assert.rejects(
    verifyWebhookSignature(verificationRequest({ toleranceSeconds: -1 })),
    /toleranceSeconds/,
  );
});
