import type { ImageModelV4, Experimental_VideoModelV4 as VideoModelV4, ImageModelV4File, SharedV4ProviderOptions } from "@ai-sdk/provider";
import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { createNodeYirClient, waitForJob } from "./client.js";
import type { CreateNodeYirClientOptions, YirClient, Job } from "./client.js";
import { YirSDKValidationError, validateGeneration } from "../shared/standard.js";
import { uploadFile } from "./files.js";
import type { RoutingOverride, StandardReference, StandardImageGenerationRequest, StandardVideoGenerationRequest } from "../shared/standard.js";

type VideoModelV4File = NonNullable<Parameters<NonNullable<VideoModelV4["doGenerate"]>>[0]["image"]>;

export type YirAIProviderOptions = CreateNodeYirClientOptions & {
  client?: YirClient;
  pollIntervalMs?: number;
};

/** AI SDK 7 / Provider V4 adapter. Uses the same Yir request and Job lifecycle. */
export function createYirAIProvider(options: YirAIProviderOptions = {}) {
  const client = options.client ?? createNodeYirClient(options);
  const fetchResult = options.fetch ?? globalThis.fetch;
  const finish = async (job: Job, signal?: AbortSignal) => job.status === "succeeded" ? job : waitForJob(client, job.id, {
    signal, pollIntervalMs: options.pollIntervalMs, timeoutMs: 0,
  });
  return {
    imageModel(modelId: string): ImageModelV4 {
      return {
        specificationVersion: "v4", provider: "yir", modelId,
        // Keep one invocation intact so model validation rejects unsupported n;
        // automatic SDK fan-out must not multiply a single Yir budget/key.
        maxImagesPerCall: Number.MAX_SAFE_INTEGER,
        async doGenerate(call) {
          call.abortSignal?.throwIfAborted();
          if (call.mask !== undefined) unsupported("image mask");
          if (call.size !== undefined) unsupported("pixel size; use Yir parameters");
          if (call.seed !== undefined) unsupported("seed");
          rejectHeaders(call.headers);
          const extension = readOptions(call.providerOptions);
          const parameters = { ...extension.parameters };
          assign(parameters, "n", call.n);
          assign(parameters, "aspect_ratio", call.aspectRatio);
          const references = call.files?.map(file => reference(file, "reference_image"));
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
            const response = await fetchResult(url, { signal: call.abortSignal, redirect: "error" });
            if (!response.ok) throw new Error("yir_result_download_failed");
            images.push(new Uint8Array(await response.arrayBuffer()));
          }
          return { images, warnings: (job.parameter_notices ?? []).map(notice => ({type: "other" as const, message: notice.message})), response: { timestamp: new Date(job.created_at * 1000), modelId, headers: undefined },
            providerMetadata: { yir: { images: images.map(() => ({ jobId: job.id, totalChargedByYir: job.billing?.total_charged_by_yir ?? null })) } } };
        },
      };
    },
    videoModel(modelId: string): VideoModelV4 {
      return {
        specificationVersion: "v4", provider: "yir", modelId,
        maxVideosPerCall: Number.MAX_SAFE_INTEGER,
        async doStart(call) {
          call.abortSignal?.throwIfAborted();
          if (call.resolution !== undefined) unsupported("pixel resolution; use Yir parameters.resolution");
          if (call.fps !== undefined) unsupported("fps");
          if (call.seed !== undefined) unsupported("seed");
          // AI SDK adds its own transient key. Yir uses the explicitly persisted
          // providerOptions key so process restarts preserve Submit identity.
          rejectHeaders(call.headers, true);
          const extension = readOptions(call.providerOptions);
          const parameters = { ...extension.parameters };
          assign(parameters, "n", call.n);
          assign(parameters, "aspect_ratio", call.aspectRatio);
          assign(parameters, "duration", call.duration);
          assign(parameters, "generate_audio", call.generateAudio);
          const inputKinds = [call.image, call.frameImages?.length, call.inputReferences?.length].filter(Boolean).length;
          if (inputKinds > 1) throw new YirSDKValidationError("input_sources_ambiguous", "input");
          const references = call.image ? [reference(call.image, "first_frame")]
            : call.frameImages?.length ? call.frameImages.map(frame => reference(frame.image, frame.frameType))
            : call.inputReferences?.map(file => {
              if (!file.mediaType) unsupported("reference without explicit media type");
              const role = file.mediaType!.startsWith("image/") ? "reference_image" : file.mediaType!.startsWith("video/") ? "reference_video" : file.mediaType!.startsWith("audio/") ? "reference_audio" : undefined;
              if (!role) unsupported("reference media type");
              return reference(file, role!);
            });
          let request: StandardVideoGenerationRequest = {
            model: modelId,
            input: references?.length ? { type: call.inputReferences?.length ? "reference" : "image", prompt: call.prompt ?? "", references } : { type: "text", prompt: call.prompt ?? "" },
            parameters, routing: extension.routing,
            ...(extension.maxCost === undefined ? {} : { max_cost: extension.maxCost }),
            ...(call.webhookUrl === undefined ? {} : { webhook_url: call.webhookUrl }),
          };
          validateGeneration("generate_video", request);
          if (request.input.type !== "text") {
            const files = call.image ? [call.image] : call.frameImages?.length ? call.frameImages.map(frame => frame.image) : call.inputReferences ?? [];
            request = { ...request, input: { ...request.input, references: await materializeReferences(client, request.input.references, files, extension.idempotencyKey, fetchResult, call.abortSignal) } };
          }
          const initial = await client.submitVideo(request, extension.idempotencyKey, { signal: call.abortSignal });
          if (!/^[1-9][0-9]*$/.test(initial.id)) throw new Error("yir_job_invalid");
          return { operation: { jobId: initial.id, modelId }, warnings: [],
            response: { timestamp: new Date(initial.created_at * 1000), modelId, headers: undefined },
            providerMetadata: { yir: { jobId: initial.id } } };
        },
        async doStatus(call) {
          call.abortSignal?.throwIfAborted();
          rejectHeaders(call.headers);
          const operation = call.operation;
          if (operation === null || typeof operation !== "object" || Array.isArray(operation) ||
            typeof operation.jobId !== "string" || !/^[1-9][0-9]*$/.test(operation.jobId) || operation.modelId !== modelId) {
            throw new YirSDKValidationError("operation_invalid", "operation");
          }
          const job = await client.getJob(operation.jobId, { signal: call.abortSignal });
          if (job.id !== operation.jobId || job.model !== modelId) throw new Error("yir_job_invalid");
          const response = { timestamp: new Date(job.created_at * 1000), modelId, headers: undefined };
          const providerMetadata = { yir: { jobId: job.id, totalChargedByYir: job.billing?.total_charged_by_yir ?? null } };
          switch (job.status) {
            case "queued": case "running": case "delivering":
              return { status: "pending", response, providerMetadata };
            case "failed": case "cancelled":
              return { status: "error", error: job.error?.code ?? (job.status === "cancelled" ? "YIR_JOB_CANCELLED" : "YIR_EXECUTION_FAILED"), response, providerMetadata };
            case "succeeded":
              if (job.result?.availability !== "available" || !job.result.files.length) throw new Error("yir_result_unavailable");
              return { status: "completed", videos: job.result.files.map(file => ({ type: "url" as const, url: file.url, mediaType: file.media_type })), warnings: (job.parameter_notices ?? []).map(notice => ({type: "other" as const, message: notice.message})), response, providerMetadata };
            default: throw new Error("yir_job_invalid");
          }
        },
      };
    },
  };
}

function unsupported(functionality: string): never { throw new UnsupportedFunctionalityError({ functionality }); }

function reference(file: ImageModelV4File | VideoModelV4File, role: StandardReference["role"]): StandardReference {
  // This placeholder is local to preflight and is always replaced before Submit.
  return { role, url: file.type === "url" ? file.url : "https://input.yir.invalid/pending-upload" };
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

function readOptions(options: SharedV4ProviderOptions) {
  const extension = options.yir ?? {};
  for (const key of Object.keys(extension)) {
    if (!["parameters", "routing", "maxCost", "idempotencyKey"].includes(key)) throw new YirSDKValidationError("unknown_field", `providerOptions.yir.${key}`);
  }
  if (typeof extension.idempotencyKey !== "string" || !extension.idempotencyKey.trim()) throw new YirSDKValidationError("idempotency_key_required", "providerOptions.yir.idempotencyKey");
  const parameters = extension.parameters === undefined ? {} : extension.parameters;
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) throw new YirSDKValidationError("object_required", "providerOptions.yir.parameters");
  if (extension.maxCost !== undefined && typeof extension.maxCost !== "string") throw new YirSDKValidationError("parameter_type", "providerOptions.yir.maxCost");
  return { parameters: parameters as Record<string, unknown>, routing: extension.routing as RoutingOverride | undefined, maxCost: extension.maxCost, idempotencyKey: extension.idempotencyKey };
}
