import { validateGeneration } from "../shared/standard.js";
import { getModelOperationContract } from "../shared/model-contracts.js";
import { checkParameterPolicies } from "../shared/parameter-rules.js";
import { validateQuoteResponse } from "../shared/quote.js";
import { createFileClient } from "./files.js";
import { modelPricesPath, validateModelPrices, type ModelPrices, type ModelPriceFilter } from "../shared/model-prices.js";
import type { YirFileClient } from "./files.js";
import type {
  StandardImageGenerationRequest,
  StandardImageQuoteRequest,
  StandardVideoGenerationRequest,
  StandardVideoQuoteRequest,
} from "../shared/standard.js";

export type { JobStatus, YirPublicError, JobResultFile, ComputeCharge, Job, QuotePrice, Quote } from "../shared/types.js";
import type { JobStatus, Job, Quote, YirPublicError } from "../shared/types.js";

export type YirTransportRequest = {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
};

export type YirTransport = <Response>(request: YirTransportRequest) => Promise<Response>;

export type YirRequestOptions = {
  readonly signal?: AbortSignal;
};

export type YirClient = YirFileClient & {
  getModelPrices(model: string, operation: ModelPrices["operation"], inputMode: ModelPrices["input_mode"], options?: YirRequestOptions & {filter?: ModelPriceFilter}): Promise<ModelPrices>;
  quoteImage(request: StandardImageQuoteRequest): Promise<Quote>;
  submitImage(request: StandardImageGenerationRequest, idempotencyKey: string, options?: YirRequestOptions): Promise<Job>;
  quoteVideo(request: StandardVideoQuoteRequest): Promise<Quote>;
  submitVideo(request: StandardVideoGenerationRequest, idempotencyKey: string, options?: YirRequestOptions): Promise<Job>;
  getJob(id: string, options?: YirRequestOptions): Promise<Job>;
  cancelJob(id: string): Promise<Job>;
};

/**
 * Transport-neutral Standard API client. Authentication stays in the injected
 * transport, so browser UI code never needs to receive an API Key secret.
 */
export function createYirClient(transport: YirTransport): YirClient {
  return {
    ...createFileClient(transport),
    getModelPrices(model, operation, inputMode, options) {
      options?.signal?.throwIfAborted();
      return transport<unknown>({method: "GET", path: modelPricesPath(model, operation, inputMode, options?.filter), ...(options?.signal ? {signal: options.signal} : {})})
        .then(value => validateModelPrices(value, model, operation, inputMode, options?.filter));
    },
    quoteImage(request) {
      validateGeneration("generate_image", request);
      warnParameterPolicies("generate_image", request);
      return transport<Quote>({
        method: "POST",
        path: "/v1/images/quotes",
        body: request,
      }).then(value => validateQuoteResponse(value, request, "generate_image"));
    },
    submitImage(request, idempotencyKey, options) {
      options?.signal?.throwIfAborted();
      const key = idempotencyKey.trim();
      if (!key) throw new Error("idempotency_key_required");
      validateGeneration("generate_image", request);
      warnParameterPolicies("generate_image", request);
      return transport<Job>({
        method: "POST",
        path: "/v1/images/generations",
        ...(options?.signal ? { signal: options.signal } : {}),
        headers: { "Idempotency-Key": key },
        body: request,
      });
    },
    quoteVideo(request) {
      validateGeneration("generate_video", request);
      warnParameterPolicies("generate_video", request);
      return transport<Quote>({
        method: "POST",
        path: "/v1/videos/quotes",
        body: request,
      }).then(value => validateQuoteResponse(value, request, "generate_video"));
    },
    submitVideo(request, idempotencyKey, options) {
      options?.signal?.throwIfAborted();
      const key = idempotencyKey.trim();
      if (!key) throw new Error("idempotency_key_required");
      validateGeneration("generate_video", request);
      warnParameterPolicies("generate_video", request);
      return transport<Job>({
        method: "POST",
        path: "/v1/videos/generations",
        ...(options?.signal ? { signal: options.signal } : {}),
        headers: { "Idempotency-Key": key },
        body: request,
      });
    },
    getJob(id, options) {
      options?.signal?.throwIfAborted();
      const normalizedID = id.trim();
      if (!/^[1-9][0-9]*$/.test(normalizedID)) throw new Error("job_id_invalid");
      const request: { method: "GET"; path: string; signal?: AbortSignal } = {
        method: "GET",
        path: `/v1/jobs/${normalizedID}`,
      };
      if (options?.signal !== undefined) {
        request.signal = options.signal;
      }
      return transport<Job>(request);
    },
    cancelJob(id) {
      const normalizedID = id.trim();
      if (!/^[1-9][0-9]*$/.test(normalizedID)) throw new Error("job_id_invalid");
      return transport<Job>({
        method: "POST",
        path: `/v1/jobs/${normalizedID}/cancel`,
      });
    },
  };
}

export const DEFAULT_GATEWAY_BASE_URL = "https://gateway.yir.ai";

// 固定日志不包含提示词、参数值、密钥或服务端任意文本。
function warnParameterPolicies(operation: "generate_image" | "generate_video", request: StandardImageQuoteRequest | StandardVideoQuoteRequest): void {
  const contract = getModelOperationContract(request.model, operation, request.input.type);
  if (!contract) return;
  for (const notice of checkParameterPolicies(contract, request.parameters, request.routing?.only)) {
    console.warn(`[Yir] ${notice.message}`);
  }
}
export const DEFAULT_USER_AGENT = "@yir/sdk/0.1.0";
export const DEFAULT_POLL_INTERVAL_MS = 2000;
export const DEFAULT_POLL_TIMEOUT_MS = 300000;

export const TERMINAL_JOB_STATUSES = Object.freeze(["succeeded", "failed", "cancelled"] as const);

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export class YirAPIError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly action?: "fix_request" | "add_funds" | "retry_later" | "contact_support";
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    retryable?: boolean;
    action?: "fix_request" | "add_funds" | "retry_later" | "contact_support";
    requestId?: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "YirAPIError";
    this.status = params.status;
    this.code = params.code ?? `HTTP_${params.status}`;
    this.retryable = params.retryable ?? false;
    this.action = params.action;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

export class YirJobError extends Error {
  readonly job: Job;
  readonly code: string;
  readonly action?: "fix_request" | "add_funds" | "retry_later" | "contact_support";
  readonly retryable: boolean;

  constructor(job: Job) {
    const detail = job.error?.message ?? (job.status === "cancelled" ? "Job was cancelled" : "Job execution failed");
    super(`Job ${job.id} ended with status '${job.status}': ${detail}`);
    this.name = "YirJobError";
    this.job = job;
    this.code = job.error?.code ?? (job.status === "cancelled" ? "YIR_JOB_CANCELLED" : "YIR_EXECUTION_FAILED");
    this.action = job.error?.action;
    this.retryable = job.error?.retryable ?? false;
  }
}

export class YirTimeoutError extends Error {
  readonly jobId: string;
  readonly timeoutMs: number;
  readonly lastJob?: Job;

  constructor(jobId: string, timeoutMs: number, lastJob?: Job) {
    super(`Timed out after ${timeoutMs}ms waiting for job ${jobId}`);
    this.name = "YirTimeoutError";
    this.jobId = jobId;
    this.timeoutMs = timeoutMs;
    this.lastJob = lastJob;
  }
}

export type WaitForJobOptions = {
  /**
   * Interval in milliseconds between polling attempts.
   * Defaults to 2000 (2 seconds).
   */
  readonly pollIntervalMs?: number;
  /**
   * Maximum wait time in milliseconds before timing out.
   * Defaults to 300000 (5 minutes). Set to 0 or Infinity to disable timeout.
   */
  readonly timeoutMs?: number;
  /**
   * Callback invoked immediately after each poll response is received.
   */
  readonly onPoll?: (job: Job) => void | Promise<void>;
  /**
   * Whether to throw a YirJobError if the job completes with 'failed' or 'cancelled' status.
   * Defaults to true. If set to false, returns the terminal Job object instead of throwing.
   */
  readonly throwOnFailure?: boolean;
  /**
   * Optional AbortSignal to cancel polling.
   */
  readonly signal?: AbortSignal;
};

export async function waitForJob(
  client: Pick<YirClient, "getJob">,
  jobId: string,
  options: WaitForJobOptions = {},
): Promise<Job> {
  const normalizedID = jobId.trim();
  if (!/^[1-9][0-9]*$/.test(normalizedID)) throw new Error("job_id_invalid");

  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (interval <= 0) throw new Error("poll_interval_invalid");

  const timeout = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const hasTimeout = typeof timeout === "number" && timeout > 0 && Number.isFinite(timeout);
  const throwOnFailure = options.throwOnFailure ?? true;
  const startTime = Date.now();

  let lastJob: Job | undefined;

  while (true) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("aborted");
    }

    if (hasTimeout && Date.now() - startTime >= timeout) {
      throw new YirTimeoutError(normalizedID, timeout, lastJob);
    }

    const remaining = hasTimeout ? timeout - (Date.now() - startTime) : undefined;
    const job = await getJobWithDeadline(client, normalizedID, options.signal, remaining, timeout, lastJob);
    lastJob = job;

    if (options.onPoll) {
      await options.onPoll(job);
    }

    if (isTerminalJobStatus(job.status)) {
      if (job.status === "succeeded") {
        return job;
      }
      if (throwOnFailure) {
        throw new YirJobError(job);
      }
      return job;
    }

    if (hasTimeout) {
      const elapsed = Date.now() - startTime;
      const remaining = timeout - elapsed;
      if (remaining <= 0) {
        throw new YirTimeoutError(normalizedID, timeout, lastJob);
      }
      const sleepMs = Math.min(interval, remaining);
      await sleep(sleepMs, options.signal);
    } else {
      await sleep(interval, options.signal);
    }
  }
}

async function getJobWithDeadline(
  client: Pick<YirClient, "getJob">,
  jobId: string,
  signal: AbortSignal | undefined,
  remainingMs: number | undefined,
  timeoutMs: number,
  lastJob: Job | undefined,
): Promise<Job> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortFromCaller = () => controller.abort(signal?.reason ?? new Error("aborted"));
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (remainingMs !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new YirTimeoutError(jobId, timeoutMs, lastJob));
    }, Math.max(0, remainingMs));
  }
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(controller.signal.reason ?? new Error("aborted")),
      { once: true },
    );
  });
  try {
    return await Promise.race([client.getJob(jobId, { signal: controller.signal }), aborted]);
  } catch (error) {
    if (timedOut) throw new YirTimeoutError(jobId, timeoutMs, lastJob);
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason ?? new Error("aborted"));
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type CreateNodeYirClientOptions = {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly userAgent?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
};

export type NodeYirClient = YirClient & {
  waitForJob(jobId: string, options?: WaitForJobOptions): Promise<Job>;
};

function getEnv(key: string): string | undefined {
  try {
    const globalObj = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
    return globalObj.process?.env?.[key];
  } catch {
    return undefined;
  }
}

export function createNodeHttpTransport(options: CreateNodeYirClientOptions = {}): YirTransport {
  // API Key 只能保存在服务端；纯共享能力不经过此入口。
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    throw new Error("server_client_not_allowed_in_browser");
  }
  const envApiKey = getEnv("YIR_API_KEY");
  const apiKey = (options.apiKey ?? envApiKey)?.trim();
  if (!apiKey) {
    throw new Error("api_key_required");
  }

  const envBaseURL = getEnv("YIR_BASE_URL");
  const rawBaseURL = options.baseURL ?? envBaseURL ?? DEFAULT_GATEWAY_BASE_URL;
  const baseURL = rawBaseURL.trim().replace(/\/+$/, "");

  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch_unavailable");
  }

  return async <Response>(request: YirTransportRequest): Promise<Response> => {
    const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
    const url = `${baseURL}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": userAgent,
      ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
      ...request.headers,
    };

    const response = await fetchFn(url, {
      method: request.method,
      headers,
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      signal: request.signal,
      redirect: "error",
    });

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    let data: unknown = text;
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) throw new Error("response_invalid");
      }
    } else if (response.ok) {
      throw new Error("response_invalid");
    }

    if (!response.ok) {
      if (typeof data === "object" && data !== null && "error" in data) {
        const errorContainer = data as { error?: YirPublicError; request_id?: string };
        const errObj = errorContainer.error;
        if (errObj && typeof errObj === "object") {
          throw new YirAPIError({
            message: errObj.message || `API request failed with status ${response.status}`,
            status: response.status,
            code: errObj.code,
            retryable: errObj.retryable,
            action: errObj.action,
            requestId: errorContainer.request_id,
            details: data,
          });
        }
      }
      const message = typeof data === "string" && data.length > 0
        ? data
        : `API request failed with status ${response.status}`;
      throw new YirAPIError({
        message,
        status: response.status,
        code: `HTTP_${response.status}`,
        details: data,
      });
    }

    return data as Response;
  };
}

export function createNodeYirClient(options: CreateNodeYirClientOptions = {}): NodeYirClient {
  const transport = createNodeHttpTransport(options);
  const baseClient = createYirClient(transport);

  return {
    ...baseClient,
    waitForJob(jobId: string, waitOptions?: WaitForJobOptions) {
      return waitForJob(baseClient, jobId, waitOptions);
    },
  };
}
