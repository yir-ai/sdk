import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { constructWebhookEvent, verifyWebhookSignature, YirWebhookVerificationError } from "../dist/index.js";
import { createHmac } from "node:crypto";

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

test("constructWebhookEvent returns the verified terminal Job", async () => {
  const event = await constructWebhookEvent(verificationRequest());
  assert.equal(event.id, vector.id);
  assert.equal(event.timestamp, Number(vector.timestamp));
  assert.equal(event.job.id, "7001");
  assert.equal(event.job.status, "succeeded");
});

test("constructWebhookEvent rejects bad signatures and non-terminal payloads", async () => {
  await assert.rejects(
    constructWebhookEvent(verificationRequest({ rawBody: encoder.encode('{"id":"7001","status":"failed"}') })),
    (error) => error instanceof YirWebhookVerificationError && error.reason === "invalid_signature",
  );
  for (const body of ["not json", "null", '{"id":"","status":"succeeded"}', '{"id":"7001","status":"running"}']) {
    const signature = "v1=" + createHmac("sha256", vector.testOnlySecret)
      .update(`${vector.timestamp}.${vector.id}.${body}`).digest("base64");
    await assert.rejects(
      constructWebhookEvent(verificationRequest({ rawBody: encoder.encode(body), signature })),
      (error) => error instanceof YirWebhookVerificationError && error.reason === "invalid_payload",
      body,
    );
  }
});
