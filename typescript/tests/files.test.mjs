import assert from "node:assert/strict";
import test from "node:test";
import { createYirClient, uploadFile, createAndUploadFile } from "../dist/index.js";

const id = "file_11111111-1111-4111-8111-111111111111";

test("file preparation normalizes metadata and freezes the caller input", async () => {
  const metadata = { name: " frame.png ", media_type: " Image/PNG ", size: 1 };
  const client = createYirClient(async request => {
    assert.deepEqual(request.body.files, [{ name: "frame.png", media_type: "image/png", size: 1 }]);
    assert.equal(metadata.name, " frame.png ");
    return { files: [{ id, object: "file", status: "ready", name: "frame.png", media_type: "image/png", size: 1 }] };
  });
  await client.createFiles({ files: [metadata] }, "key");
  await createAndUploadFile(client, metadata, new Blob(["x"]), "key");
  assert.equal(metadata.media_type, " Image/PNG ");
});

test("oversized UTF-8 file identity is rejected before transport", async () => {
  let calls = 0;
  const client = createYirClient(async () => { calls++; throw new Error("transport"); });
  await assert.rejects(client.createFiles({ files: [{ name: "图".repeat(86), media_type: "image/png", size: 1 }] }, "key"));
  await assert.rejects(client.createFiles({ files: [{ name: "a.png", media_type: "image/png", size: 1 }] }, "k".repeat(256)));
  assert.equal(calls, 0);
});
const plan = () => ({ id, object: "file", name: "frame.png", media_type: "image/png", size: 6, status: "pending_upload",
  upload: { type: "multipart", expires_at: Math.floor(Date.now() / 1000) + 300,
    parts: [{ part_number: 1, size: 2, url: "https://uploads.example/1" }, { part_number: 2, size: 4, url: "https://uploads.example/2" }] } });

test("single file preparation recovers a lost completion without another upload", async () => {
  let ready = false, puts = 0, completions = 0;
  const keys = [];
  const client = createYirClient(async request => {
    if (request.path === "/v1/files") {
      keys.push(request.headers["Idempotency-Key"]);
      return { files: [{ ...plan(), ...(ready ? { status: "ready", upload: undefined } : {}) }] };
    }
    assert.equal(request.path, `/v1/files/${id}/complete`);
    completions++;
    ready = true;
    throw new Error("completion_response_lost");
  });
  const metadata = { name: "frame.png", media_type: "image/png", size: 6 };
  const options = { fetch: async () => { puts++; return new Response(null, { status: 200 }); } };
  await assert.rejects(() => createAndUploadFile(client, metadata, new Blob(["abcdef"]), "persistent-key", options), /completion_response_lost/);
  const file = await createAndUploadFile(client, metadata, new Blob(["abcdef"]), "persistent-key", options);
  assert.equal(file.status, "ready");
  assert.equal(puts, 2);
  assert.equal(completions, 1);
  assert.deepEqual(keys, ["persistent-key", "persistent-key"]);
});

test("single file preparation validates source before creating and rejects false completion", async () => {
  let calls = 0;
  const client = createYirClient(async () => { calls++; return { files: [plan()] }; });
  await assert.rejects(() => createAndUploadFile(client, { name: "frame.png", media_type: "image/png", size: 6 }, new Blob(["short"]), "key"));
  assert.equal(calls, 0);
  for (const patch of [{ status: "pending_upload" }, { size: 5 }, { media_type: "video/mp4" }]) {
    await assert.rejects(() => uploadFile({ completeFile: async () => ({ ...plan(), status: "ready", ...patch }) }, plan(), new Blob(["abcdef"]),
      { fetch: async () => new Response(null, { status: 200 }) }), /file_response_invalid/);
  }
});

test("file creation, ordered upload and completion use separate authorization boundaries", async () => {
  const calls = [];
  const pieces = [];
  const client = createYirClient(async request => {
    calls.push(request);
    if (request.path === "/v1/files") return { files: [plan()] };
    if (request.path.endsWith("/complete")) {
      assert.deepEqual(pieces, ["ab", "cdef"]);
      assert.deepEqual(request.body, {});
      return { ...plan(), status: "ready", upload: undefined };
    }
    return plan();
  });
  const files = await client.createFiles({ files: [{ name: "frame.png", media_type: "image/png", size: 6 }] }, "persisted-create-key");
  const result = await uploadFile(client, files[0], new Blob(["abcdef"]), { fetch: async (url, request) => {
    assert.equal(request.method, "PUT");
    assert.equal(request.headers, undefined);
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "error");
    pieces.push(await request.body.text());
    return new Response(null, { status: 200 });
  }});
  assert.equal(result.status, "ready");
  assert.equal(calls[0].headers["Idempotency-Key"], "persisted-create-key");
  assert.equal(calls[1].path, `/v1/files/${id}/complete`);
});

test("invalid file metadata never reaches transport", async () => {
  let calls = 0;
  const client = createYirClient(async () => { calls++; return {}; });
  for (const file of [null, { name: "../frame.png", media_type: "image/png", size: 1 },
    { name: "a.png", media_type: "image/png", size: 0 }, { name: "a.png", media_type: "image/png", size: 2147483649 },
    { name: "a", media_type: "application/octet-stream", size: 1 }, { name: "a", media_type: "image/png", size: "1" }]) {
    await assert.rejects(() => client.createFiles({ files: [file] }, "key"));
  }
  assert.equal(calls, 0);
});

test("invalid plans are rejected before the first part is uploaded", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return new Response(); };
  const client = { completeFile: async () => { calls++; return {}; } };
  for (const change of [
    file => { file.upload.parts[1].size = 3; },
    file => { file.upload.parts[1].url = "http://uploads.example/2"; },
    file => { file.upload.parts[0].part_number = 2; },
    file => { file.upload.expires_at = 1; },
  ]) {
    const file = plan(); change(file);
    await assert.rejects(() => uploadFile(client, file, new Blob(["abcdef"]), { fetch }));
  }
  assert.equal(calls, 0);
});

test("upload failure neither retries nor confirms completion and hides signed URL errors", async () => {
  let completed = 0;
  const client = { completeFile: async () => { completed++; return {}; } };
  let uploaded = 0;
  await assert.rejects(() => uploadFile(client, plan(), new Blob(["abcdef"]), { fetch: async () => {
    uploaded++; throw new Error("https://uploads.example/secret-signature");
  }}), error => error.message === "upload_transport_failed");
  assert.equal(uploaded, 1);
  assert.equal(completed, 0);
});

test("file operations respect abort and validate returned identity", async () => {
  let calls = 0;
  const client = createYirClient(async () => { calls++; return { ...plan(), id: "file_22222222-2222-4222-8222-222222222222" }; });
  await assert.rejects(() => client.getFile(id, { signal: AbortSignal.abort(new Error("stop")) }), /stop/);
  assert.equal(calls, 0);
  await assert.rejects(() => client.getFile(id), /file_response_invalid/);
});
