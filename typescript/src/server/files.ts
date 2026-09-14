import type { YirTransport, YirRequestOptions } from "./client.js";
import { YirSDKValidationError } from "../shared/standard.js";

export type CreateFile = { readonly name: string; readonly media_type: string; readonly size: number };
export type CreateFilesRequest = { readonly files: readonly CreateFile[]; readonly upload_mode?: "auto" | "multipart" };
export type InputFile = CreateFile & {
  readonly id: string;
  readonly object: "file";
  readonly status: "pending_upload" | "ready" | "expired" | "failed";
  readonly url?: string;
  readonly expires_at?: number;
  readonly upload?: {
    readonly type: "multipart";
    readonly expires_at: number;
    readonly parts: readonly { readonly part_number: number; readonly size: number; readonly url: string }[];
  };
};

export type YirFileClient = {
  createFiles(request: CreateFilesRequest, idempotencyKey: string, options?: YirRequestOptions): Promise<readonly InputFile[]>;
  getFile(id: string, options?: YirRequestOptions): Promise<InputFile>;
  completeFile(id: string, options?: YirRequestOptions): Promise<InputFile>;
};

const fileIDPattern = /^file_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const allowedMediaTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/wav"]);

export function createFileClient(transport: YirTransport): YirFileClient {
  return {
    async createFiles(request, idempotencyKey, options) {
      options?.signal?.throwIfAborted();
      const key = idempotencyKey.trim();
      if (!key || new TextEncoder().encode(key).length > 255 || /[\r\n]/.test(key)) invalid("idempotency_key_invalid", "idempotencyKey");
      if (!request || !Array.isArray(request.files) || request.files.length < 1 || request.files.length > 20) invalid("file_count_invalid", "files");
      if (request.upload_mode !== undefined && request.upload_mode !== "auto" && request.upload_mode !== "multipart") invalid("upload_mode_invalid", "upload_mode");
      for (const field of Object.keys(request)) if (!["files", "upload_mode"].includes(field)) invalid("unknown_field", field);
      request = { ...request, files: request.files.map((file, index) => normalizeFileMetadata(file, `files.${index}`)) };
      const result = await transport<{ files: InputFile[] }>({ method: "POST", path: "/v1/files", headers: { "Idempotency-Key": key }, body: request,
        ...(options?.signal ? { signal: options.signal } : {}) });
      if (!result || !Array.isArray(result.files) || result.files.length !== request.files.length) throw new Error("file_response_invalid");
      for (const [index, file] of result.files.entries()) {
        validateFileResponse(file);
        const expected = request.files[index]!;
        if (file.name !== expected.name || file.size !== expected.size || file.media_type !== expected.media_type) throw new Error("file_response_invalid");
      }
      return result.files;
    },
    getFile(id, options) { return fileRequest(transport, id, false, options); },
    completeFile(id, options) { return fileRequest(transport, id, true, options); },
  };
}

function validateFileMetadata(file: CreateFile, path: string) {
  if (!file || typeof file !== "object" || Array.isArray(file)) invalid("file_metadata_invalid", path);
  for (const field of Object.keys(file)) if (!["name", "media_type", "size"].includes(field)) invalid("unknown_field", `${path}.${field}`);
  if (typeof file.name !== "string" || !file.name.trim() || new TextEncoder().encode(file.name.trim()).length > 255 || /[\x00-\x1f\x7f/\\]/.test(file.name)) invalid("file_name_invalid", `${path}.name`);
  if (!allowedMediaTypes.has(file.media_type)) invalid("file_media_type_invalid", `${path}.media_type`);
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 2147483648) invalid("file_size_invalid", `${path}.size`);
}

function normalizeFileMetadata(file: CreateFile, path: string): CreateFile {
  if (!file || typeof file !== "object") invalid("file_metadata_invalid", path);
  const normalized = { ...file, name: typeof file.name === "string" ? file.name.trim() : file.name,
    media_type: typeof file.media_type === "string" ? file.media_type.trim().toLowerCase() : file.media_type };
  validateFileMetadata(normalized, path);
  return normalized;
}

function validateFileResponse(file: InputFile) {
  if (!file || !fileIDPattern.test(file.id) || file.object !== "file" || !["pending_upload", "ready", "expired", "failed"].includes(file.status)) throw new Error("file_response_invalid");
}

async function fileRequest(transport: YirTransport, id: string, complete: boolean, options?: YirRequestOptions): Promise<InputFile> {
  options?.signal?.throwIfAborted();
  if (!fileIDPattern.test(id)) invalid("file_id_invalid", "id");
  const result = await transport<InputFile>({ method: complete ? "POST" : "GET", path: `/v1/files/${id}${complete ? "/complete" : ""}`,
    ...(complete ? { body: {} } : {}), ...(options?.signal ? { signal: options.signal } : {}) });
  validateFileResponse(result);
  if (result.id !== id) throw new Error("file_response_invalid");
  return result;
}

/** Reuses a ready file or streams its issued plan, then confirms completion. */
export async function uploadFile(client: Pick<YirFileClient, "completeFile">, file: InputFile, data: Blob,
  options: YirRequestOptions & { fetch?: typeof globalThis.fetch } = {}): Promise<InputFile> {
  options.signal?.throwIfAborted();
  validateFileResponse(file);
  if (!(data instanceof Blob) || data.size !== file.size || file.size < 1 || file.size > 2147483648) invalid("upload_source_invalid", "data");
  if (file.status === "ready") return file;
  const plan = file.upload;
  if (!(data instanceof Blob) || data.size !== file.size || file.size < 1 || file.size > 2147483648 || file.status !== "pending_upload" ||
    !plan || plan.type !== "multipart" || !Number.isSafeInteger(plan.expires_at) || plan.expires_at <= Math.floor(Date.now() / 1000) || !Array.isArray(plan.parts) || !plan.parts.length) invalid("upload_plan_invalid", "upload");
  let total = 0;
  for (const [index, part] of plan.parts.entries()) {
    if (part.part_number !== index + 1 || !Number.isSafeInteger(part.size) || part.size <= 0 || part.size > file.size - total) invalid("upload_plan_invalid", "upload.parts");
    try {
      const url = new URL(part.url);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    } catch { invalid("upload_plan_invalid", "upload.parts"); }
    total += part.size;
  }
  if (total !== file.size) invalid("upload_plan_invalid", "upload.parts");
  const fetchPart = options.fetch ?? globalThis.fetch;
  let offset = 0;
  for (const part of plan.parts) {
    let response: Response;
    try {
      response = await fetchPart(part.url, { method: "PUT", body: data.slice(offset, offset + part.size), signal: options.signal,
        redirect: "error", credentials: "omit" });
    } catch {
      options.signal?.throwIfAborted();
      // Network errors can contain the signed upload URL; never echo them.
      throw new Error("upload_transport_failed");
    }
    await response.body?.cancel();
    if (!response.ok) throw new Error(`upload_failed:${response.status}`);
    offset += part.size;
  }
  const ready = await client.completeFile(file.id, options);
  validateFileResponse(ready);
  if (ready.status !== "ready" || ready.id !== file.id || ready.name !== file.name || ready.media_type !== file.media_type || ready.size !== file.size) throw new Error("file_response_invalid");
  return ready;
}

/** Persist key before calling; retries must use identical metadata and bytes. */
export async function createAndUploadFile(client: Pick<YirFileClient, "createFiles" | "completeFile">,
  metadata: CreateFile, data: Blob, key: string,
  options: YirRequestOptions & { fetch?: typeof globalThis.fetch } = {}): Promise<InputFile> {
  options.signal?.throwIfAborted();
  metadata = normalizeFileMetadata(metadata, "file");
  if (!(data instanceof Blob) || data.size !== metadata.size) invalid("upload_source_invalid", "data");
  const files = await client.createFiles({ files: [metadata], upload_mode: "multipart" }, key, options);
  if (files.length !== 1) throw new Error("file_response_invalid");
  const file = files[0]!;
  validateFileResponse(file);
  if (file.name !== metadata.name || file.media_type !== metadata.media_type || file.size !== metadata.size) throw new Error("file_response_invalid");
  return uploadFile(client, file, data, options);
}

function invalid(code: string, path: string): never { throw new YirSDKValidationError(code, path); }
