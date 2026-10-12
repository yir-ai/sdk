import type { ImageModelV4, Experimental_VideoModelV4 as VideoModelV4, ImageModelV4File, SharedV4ProviderOptions } from "@ai-sdk/provider";
import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { createNodeYirClient, isValidJobID, waitForJob } from "./client.js";
import type { CreateNodeYirClientOptions, YirClient, Job } from "./client.js";
import { YirSDKValidationError, validateGeneration } from "../shared/standard.js";
import { uploadFile } from "./files.js";
import { findModelContract, findModelOperationContract } from "../shared/catalog.js";
import type { RoutingOverride, StandardReference, StandardImageGenerationRequest, StandardVideoGenerationRequest } from "../shared/standard.js";

type VideoModelV4File = NonNullable<Parameters<NonNullable<VideoModelV4["doGenerate"]>>[0]["image"]>;

export type YirAIProviderOptions = CreateNodeYirClientOptions & {
  client?: YirClient;
  pollIntervalMs?: number;
};

/** Additive capabilities also available when compiled with older Provider V4 versions. */
export type YirAIImageModel = ImageModelV4 & {
  readonly supportsFileInputs: boolean | undefined;
  readonly supportsMaskInputs: false;
};

/** AI SDK 7 / Provider V4 adapter. Uses the same Yir request and Job lifecycle. */
export function createYirAIProvider(options: YirAIProviderOptions = {}) {
  const client = options.client ?? createNodeYirClient(options);
  const fetchResult = options.fetch ?? globalThis.fetch;
  const finish = async (job: Job, signal?: AbortSignal) => job.status === "succeeded" ? job : waitForJob(client, job.id, {
    signal, pollIntervalMs: options.pollIntervalMs, timeoutMs: 0,
  });
  const provider = {
    imageModel(modelId: string): YirAIImageModel {
      const catalog = options.modelContracts ?? client.modelContracts;
      const contract = catalog?.schema_version === "v1" ? findModelContract(catalog, modelId) : undefined;
      const supportsFiles = contract?.operations.some(operation => {
        const input = operation.input_constraints.image;
        return operation.operation === "generate_image" && operation.input_modes.includes("image") &&
          input !== undefined && input.max_references > 0 && input.allowed_reference_roles.includes("reference_image");
      });
      return {
        specificationVersion: "v4", provider: "yir", modelId,
        // Keep one invocation intact so model validation rejects unsupported n;
        // automatic SDK fan-out must not multiply a single Yir budget/key.
        maxImagesPerCall: Number.MAX_SAFE_INTEGER,
        supportsFileInputs: supportsFiles, supportsMaskInputs: false,
        async doGenerate(call) {
          call.abortSignal?.throwIfAborted();
          if (call.mask !== undefined) unsupported("image mask");
          rejectHeaders(call.headers, true);
          const extension = readOptions(call.providerOptions, call.headers);
          const parameters = { ...extension.parameters };
          assign(parameters, "n", call.n);
          assign(parameters, "size", call.size);
          assign(parameters, "aspect_ratio", call.aspectRatio);
          // Standard settings map to same-named Yir parameters; the model contract decides support.
          const warnings = assignOptional(parameters, { seed: call.seed });
          const references = call.files?.map((file, index) => reference(file, "reference_image", index));
          let request: StandardImageGenerationRequest = {
            model: modelId,
            input: references?.length ? { type: "image", prompt: call.prompt ?? "", references } : { type: "text", prompt: call.prompt ?? "" },
            parameters, routing: extension.routing,
            ...(extension.maxCost === undefined ? {} : { max_cost: extension.maxCost }),
          };
          validateGeneration("generate_image", request);
          if (request.input.type === "image") {
            request = { ...request, input: { ...request.input, references: await materializeReferences(client, request.input.references, call.files ?? [], extension.idempotencyKey, fetchResult, call.abortSignal) } };
          }
          const initial = await client.submitImage(request, extension.idempotencyKey, { signal: call.abortSignal });
          const job = await finish(initial, call.abortSignal);
          if (job.result?.availability !== "available" || !job.result.files.length) throw new Error("yir_result_unavailable");
          const images: Uint8Array[] = [];
          for (const file of job.result.files) {
            const url = new URL(file.url);
            if (url.protocol !== "https:" || url.username || url.password) throw new Error("yir_result_url_invalid");
            const response = await fetchResult(url, { signal: call.abortSignal, redirect: "manual" });
            if (!response.ok) {
              await response.body?.cancel();
              throw new Error("yir_result_download_failed");
            }
            images.push(new Uint8Array(await response.arrayBuffer()));
          }
          return { images, warnings: [...warnings, ...noticeWarnings(job)], response: { timestamp: new Date(job.created_at * 1000), modelId, headers: undefined },
            providerMetadata: { yir: { images: images.map(() => ({ jobId: job.id, totalChargedByYir: job.billing?.total_charged_by_yir ?? null })) } } };
        },
      };
    },
    videoModel(modelId: string): VideoModelV4 {
      const catalog = options.modelContracts ?? client.modelContracts;
      return {
        specificationVersion: "v4", provider: "yir", modelId,
        maxVideosPerCall: Number.MAX_SAFE_INTEGER,
        async handleWebhookOption({ webhook }) {
          const { url, received } = await webhook();
          // The receiver verifies and correlates notifications. AI SDK uses them
          // only to wake up doStatus, which reads the original Job from Yir.
          return { webhookUrl: url, received };
        },
        async doStart(call) {
          call.abortSignal?.throwIfAborted();
          // Preserve the explicit Yir key, or AI SDK's per-invocation key across
          // outer SDK retries. The selected key also identifies inline uploads.
          rejectHeaders(call.headers, true);
          const extension = readOptions(call.providerOptions, call.headers);
          const parameters = { ...extension.parameters };
          assign(parameters, "n", call.n);
          assign(parameters, "duration", call.duration);
          assign(parameters, "size", call.resolution);
          assign(parameters, "generate_audio", call.generateAudio);
          const warnings = assignOptional(parameters, { fps: call.fps, seed: call.seed });
          // AI SDK mirrors frameImages' first frame in image. Prefer role-tagged
          // frames; when only a last frame is supplied, keep prompt.image as the first.
          const frames = [...(call.frameImages ?? [])];
          if (call.image && !frames.some(frame => frame.frameType === "first_frame")) frames.unshift({ image: call.image, frameType: "first_frame" });
          if (frames.length && call.inputReferences?.length) throw new YirSDKValidationError("input_sources_ambiguous", "input");
          const references = frames.length ? frames.map((frame, index) => reference(frame.image, frame.frameType, index))
            : call.inputReferences?.map((file, index) => {
              if (!file.mediaType) unsupported("reference without explicit media type");
              const role = file.mediaType!.startsWith("image/") ? "reference_image" : file.mediaType!.startsWith("video/") ? "reference_video" : file.mediaType!.startsWith("audio/") ? "reference_audio" : undefined;
              if (!role) unsupported("reference media type");
              return reference(file, role!, index);
            });
          let request: StandardVideoGenerationRequest = {
            model: modelId,
            input: references?.length ? { type: call.inputReferences?.length ? "reference" : "image", prompt: call.prompt ?? "", references } : { type: "text", prompt: call.prompt ?? "" },
            parameters, routing: extension.routing,
            ...(extension.maxCost === undefined ? {} : { max_cost: extension.maxCost }),
            ...(call.webhookUrl === undefined ? {} : { webhook_url: call.webhookUrl }),
          };
          // AI SDK uses adaptive for inherited media proportions. Some native
          // contracts call this auto; preserve adaptive wherever it is supported.
          let aspectRatio: string | undefined = call.aspectRatio;
          if (aspectRatio === "adaptive" && request.input.type !== "text") {
            const values = catalog?.schema_version === "v1"
              ? findModelOperationContract(catalog, modelId, "generate_video", request.input.type)
                ?.parameters.find(parameter => parameter.name === "aspect_ratio")?.values
              : undefined;
            if (parameters.aspect_ratio === "auto" || values?.includes("auto") && !values.includes("adaptive")) aspectRatio = "auto";
          }
          assign(parameters, "aspect_ratio", aspectRatio);
          validateGeneration("generate_video", request);
          if (request.input.type !== "text") {
            const files = frames.length ? frames.map(frame => frame.image) : call.inputReferences ?? [];
            request = { ...request, input: { ...request.input, references: await materializeReferences(client, request.input.references, files, extension.idempotencyKey, fetchResult, call.abortSignal) } };
          }
          const initial = await client.submitVideo(request, extension.idempotencyKey, { signal: call.abortSignal });
          if (!isValidJobID(initial.id)) throw new Error("yir_job_invalid");
          return { operation: { jobId: initial.id, modelId }, warnings,
            response: { timestamp: new Date(initial.created_at * 1000), modelId, headers: undefined },
            providerMetadata: { yir: { jobId: initial.id } } };
        },
        async doStatus(call) {
          call.abortSignal?.throwIfAborted();
          rejectHeaders(call.headers, true);
          const operation = call.operation;
          if (operation === null || typeof operation !== "object" || Array.isArray(operation) ||
            !("jobId" in operation) || !("modelId" in operation) ||
            !isValidJobID(operation.jobId) || operation.modelId !== modelId) {
            throw new YirSDKValidationError("operation_invalid", "operation");
          }
          const job = await client.getJob(operation.jobId, { signal: call.abortSignal });
          // job.model is the canonical ID even when modelId is an alias.
          if (job.id !== operation.jobId) throw new Error("yir_job_invalid");
          const response = { timestamp: new Date(job.created_at * 1000), modelId, headers: undefined };
          const providerMetadata = { yir: { jobId: job.id, totalChargedByYir: job.billing?.total_charged_by_yir ?? null } };
          switch (job.status) {
            case "failed": case "cancelled":
              return { status: "error", error: job.error?.code ?? (job.status === "cancelled" ? "YIR_JOB_CANCELLED" : "YIR_EXECUTION_FAILED"), response, providerMetadata };
            case "succeeded": {
              if (job.result?.availability !== "available" || !job.result.files.length) throw new Error("yir_result_unavailable");
              const videos = job.result.files.filter(file => file.media_type.startsWith("video/"));
              if (!videos.length) throw new Error("yir_result_unavailable");
              const additionalFiles = job.result.files.filter(file => !file.media_type.startsWith("video/"));
              return { status: "completed", videos: videos.map(file => ({ type: "url" as const, url: file.url, mediaType: file.media_type })), warnings: noticeWarnings(job), response,
                providerMetadata: { yir: { ...providerMetadata.yir, ...(additionalFiles.length ? { additionalFiles: additionalFiles.map(file => ({ ...file })) } : {}) } } };
            }
            // queued, running, delivering and statuses newer than this SDK are in progress.
            default: return { status: "pending", response, providerMetadata };
          }
        },
      };
    },
  };
  return { ...provider, image: provider.imageModel, video: provider.videoModel };
}

function unsupported(functionality: string): never { throw new UnsupportedFunctionalityError({ functionality }); }

function reference(file: ImageModelV4File | VideoModelV4File, role: StandardReference["role"], index: number): StandardReference {
  if (file.type === "url") {
    try {
      const url = new URL(file.url);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    } catch {
      throw new YirSDKValidationError("url_invalid", `input.references.${index}.url`);
    }
    // The Gateway imports public URLs through its existing media safety boundary.
    return { role, url: file.url };
  }
  // This placeholder is local to preflight and is always replaced before Submit.
  return { role, file_id: `file_00000000-0000-4000-8000-${String(index).padStart(12, "0")}` };
}

async function materializeReferences(client: YirClient, references: readonly StandardReference[], files: readonly (ImageModelV4File | VideoModelV4File)[],
  key: string, fetchPart: typeof globalThis.fetch, signal?: AbortSignal): Promise<readonly StandardReference[]> {
  const inline = [];
  for (const [index, file] of files.entries()) {
    if (file.type === "url") continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = typeof file.data === "string" ? Uint8Array.from(atob(file.data), character => character.charCodeAt(0)) : Uint8Array.from(file.data);
    } catch { throw new YirSDKValidationError("file_data_invalid", `input.references.${index}`); }
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    inline.push({ index, data: new Blob([bytes]), metadata: { name: `reference-${index}-${hash}`, media_type: file.mediaType, size: bytes.byteLength } });
  }
  if (!inline.length) return references;
  // The content digest in metadata makes reuse of a key with changed bytes conflict.
  const plans = await client.createFiles({ files: inline.map(file => file.metadata) }, `${key}:inputs`, { signal });
  const resolved = [...references];
  for (const [index, input] of inline.entries()) {
    const plan = plans[index]!;
    const ready = await uploadFile(client, plan, input.data, { fetch: fetchPart, signal });
    if (ready.status !== "ready") throw new Error("yir_input_not_ready");
    resolved[input.index] = { role: references[input.index]!.role, file_id: ready.id };
  }
  return resolved;
}

function rejectHeaders(headers: Record<string, string | undefined> | undefined, allowIdempotencyKey = false) {
  if (headers && Object.entries(headers).some(([key, value]) => key.toLowerCase() !== "user-agent" && !(allowIdempotencyKey && key.toLowerCase() === "idempotency-key") && value !== undefined)) unsupported("per-call headers; configure the native client transport");
}

function assign(parameters: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined) return;
  if (Object.hasOwn(parameters, key) && parameters[key] !== value) throw new YirSDKValidationError("parameter_conflict", `parameters.${key}`);
  parameters[key] = value;
}

function readOptions(options: SharedV4ProviderOptions, headers?: Record<string, string | undefined>) {
  const extension = options.yir ?? {};
  for (const key of Object.keys(extension)) {
    if (!["parameters", "routing", "maxCost", "idempotencyKey"].includes(key)) throw new YirSDKValidationError("unknown_field", `providerOptions.yir.${key}`);
  }
  if (extension.idempotencyKey !== undefined && (typeof extension.idempotencyKey !== "string" || !extension.idempotencyKey.trim() || /[\r\n]/.test(extension.idempotencyKey))) throw new YirSDKValidationError("idempotency_key_invalid", "providerOptions.yir.idempotencyKey");
  const parameters = extension.parameters === undefined ? {} : extension.parameters;
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) throw new YirSDKValidationError("object_required", "providerOptions.yir.parameters");
  if (extension.maxCost !== undefined && typeof extension.maxCost !== "string") throw new YirSDKValidationError("parameter_type", "providerOptions.yir.maxCost");
  return { parameters: parameters as Record<string, unknown>, routing: extension.routing as RoutingOverride | undefined, maxCost: extension.maxCost, idempotencyKey: extension.idempotencyKey?.trim() ?? headerIdempotencyKey(headers) ?? crypto.randomUUID() };
}

/** Never forward arbitrary call headers or include a supplied key in an error. */
function headerIdempotencyKey(headers: Record<string, string | undefined> | undefined): string | undefined {
  const keys = Object.entries(headers ?? {}).filter(([name, value]) => name.toLowerCase() === "idempotency-key" && value !== undefined)
    .map(([, value]) => value!);
  if (!keys.length) return undefined;
  if (keys.some(key => typeof key !== "string" || !key.trim() || /[\r\n]/.test(key)) || keys.some(key => key.trim() !== keys[0]!.trim())) {
    throw new YirSDKValidationError("idempotency_key_invalid", "headers.Idempotency-Key");
  }
  return keys[0]!.trim();
}

type AdapterWarning = { readonly type: "unsupported"; readonly feature: string; readonly details?: string } | { readonly type: "other"; readonly message: string };

/**
 * Forward explicitly supplied settings. The Gateway owns current capabilities;
 * a stale local catalog must not silently discard a caller's requested value.
 */
function assignOptional(parameters: Record<string, unknown>,
  settings: Readonly<Record<string, unknown>>): AdapterWarning[] {
  const warnings: AdapterWarning[] = [];
  for (const [name, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    assign(parameters, name, value);
  }
  return warnings;
}

function noticeWarnings(job: Job): AdapterWarning[] {
  return [
    ...(job.parameter_notices ?? []).map(notice => ({ type: "other" as const, message: notice.message })),
    ...(job.result?.availability === "available" ? job.result.warnings ?? [] : []).map(warning => ({ type: "other" as const, message: warning })),
  ];
}
