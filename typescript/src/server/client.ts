import { PACKAGE_VERSION } from "./package-version.js";
import { validateGeneration } from "../shared/standard.js";
import { modelContractPath, modelDetailPath, parseModelContractCatalog, parseModelContractDetail, parseModelDetail, type ModelContractCatalog, type ModelContractDetail, type ModelDetail } from "../shared/catalog.js";
import { validateQuoteBatchResponse, validateQuoteResponse } from "../shared/quote.js";
import { createFileClient } from "./files.js";
import type { YirFileClient } from "./files.js";
import type {
  StandardImageGenerationRequest,
  StandardImageQuoteRequest,
  StandardMusicGenerationRequest,
  StandardMusicQuoteRequest,
  StandardVideoGenerationRequest,
  StandardVideoQuoteRequest,
} from "../shared/standard.js";

export type { JobStatus, JobCancellation, JobStatusResponse, YirErrorCode, YirErrorAction, YirPublicError, YirProviderError, JobResultFile, JobResultFileFidelity, JobResultContentSafety, ComputeCharge, Job, QuotePrice, Quote, QuoteBatchRequestItem, QuoteBatchItem, QuoteBatch } from "../shared/types.js";
import type { JobStatus, JobStatusResponse, Job, Quote, YirErrorAction, YirPublicError, QuoteBatchRequestItem, QuoteBatch } from "../shared/types.js";

export type YirTransportRequest = {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  /**
   * "manual" asks the transport to return a 3xx as `{ status, location }`
   * without following it or sending credentials to the target. Transports that
   * ignore it make redirect-only calls fail closed.
   */
  readonly redirect?: "manual";
  /**
   * Milliseconds the Gateway may deliberately hold this request (status long
   * polling). Transports with a per-request limit extend it by this amount.
   */
  readonly holdMs?: number;
};

/** Result of a `redirect: "manual"` request that received a 3xx response. */
export type YirTransportRedirect = { readonly status: number; readonly location: string | null };

export type YirTransport = <Response>(request: YirTransportRequest) => Promise<Response>;

export type YirRequestOptions = {
  readonly signal?: AbortSignal;
};

/** Wallet snapshot; available/total can be negative after actual-cost settlement. */
export type Balance = {
  readonly object: "balance";
  readonly currency: "USD";
  readonly available_amount: string;
  readonly held_amount: string;
  readonly total_amount: string;
};

function parseBalance(value: unknown): Balance {
  const balance = value as Balance | null;
  const amount = (value: unknown, signed: boolean) => typeof value === "string" &&
    (signed ? /^-?[0-9]+(?:\.[0-9]+)?$/ : /^[0-9]+(?:\.[0-9]+)?$/).test(value);
  if (!balance || balance.object !== "balance" || balance.currency !== "USD" ||
    !amount(balance.available_amount, true) || !amount(balance.held_amount, false) || !amount(balance.total_amount, true)) {
    throw new Error("balance_response_invalid");
  }
  return balance;
}

/** A failed submit can already have been accepted. Retry the original body with this key. */
export type YirSubmissionError = Error & { readonly idempotencyKey: string };

function submissionError(cause: unknown, key: string): YirSubmissionError {
  // Preserve APIError/AbortError identity for existing callers. A frozen custom
  // transport error remains accessible through cause instead of losing the key.
  // Reused errors (for example an abort reason) must not overwrite an earlier key.
  const error = cause instanceof Error && Object.isExtensible(cause) && !("idempotencyKey" in cause)
    ? cause : new Error("job_submit_failed", { cause });
  Object.defineProperty(error, "idempotencyKey", { value: key, configurable: true });
  return error as YirSubmissionError;
}

export type YirJobStatusOptions = YirRequestOptions & {
  /**
   * Long polling: whole seconds (0-30) the Gateway may hold the query until the
   * status changes. A terminal Job answers at once. Defaults to 0.
   */
  readonly waitSeconds?: number;
};

export type YirClient = YirFileClient & {
  getBalance(options?: YirRequestOptions): Promise<Balance>;
  readonly modelContracts?: ModelContractCatalog;
  getModelContracts(options?: YirRequestOptions): Promise<ModelContractCatalog>;
  getModelContract(model: string, options?: YirRequestOptions): Promise<ModelContractDetail>;
  getModel(model: string, options?: YirRequestOptions): Promise<ModelDetail>;
  quoteImage(request: StandardImageQuoteRequest, options?: YirRequestOptions): Promise<Quote>;
  quoteBatch(requests: readonly QuoteBatchRequestItem[], options?: YirRequestOptions): Promise<QuoteBatch>;
  submitImage(request: StandardImageGenerationRequest, idempotencyKey?: string, options?: YirRequestOptions): Promise<Job>;
  quoteVideo(request: StandardVideoQuoteRequest, options?: YirRequestOptions): Promise<Quote>;
  submitVideo(request: StandardVideoGenerationRequest, idempotencyKey?: string, options?: YirRequestOptions): Promise<Job>;
  quoteMusic(request: StandardMusicQuoteRequest, options?: YirRequestOptions): Promise<Quote>;
  submitMusic(request: StandardMusicGenerationRequest, idempotencyKey?: string, options?: YirRequestOptions): Promise<Job>;
  getJob(id: string, options?: YirRequestOptions): Promise<Job>;
  getJobStatus(id: string, options?: YirJobStatusOptions): Promise<JobStatusResponse>;
  cancelJob(id: string, options?: YirRequestOptions): Promise<Job>;
};

/**
 * Transport-neutral Standard API client. Authentication stays in the injected
 * transport, so browser UI code never needs to receive an API Key secret.
 */
export function createYirClient(transport: YirTransport, catalog?: ModelContractCatalog): YirClient {
  const localCatalog = catalog === undefined ? undefined : parseModelContractCatalog(catalog);
  return {
    ...createFileClient(transport),
    modelContracts: localCatalog,
    getBalance(options) {
      options?.signal?.throwIfAborted();
      return transport<unknown>({ method: "GET", path: "/v1/balance",
        ...(options?.signal ? { signal: options.signal } : {}),
      }).then(parseBalance);
    },
    getModelContracts(options) {
      options?.signal?.throwIfAborted();
      return transport<unknown>({
        method: "GET", path: "/v1/models?include=parameters",
        ...(options?.signal ? { signal: options.signal } : {}),
      }).then(parseModelContractCatalog);
    },
    async getModelContract(model, options) {
      options?.signal?.throwIfAborted();
      const value = await transport<unknown>({
        method: "GET", path: modelContractPath(model),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      return parseModelContractDetail(value, model);
    },
    async getModel(model, options) {
      options?.signal?.throwIfAborted();
      const value = await transport<unknown>({
        method: "GET", path: modelDetailPath(model),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      return parseModelDetail(value, model);
    },
    quoteImage(request, options) {
      options?.signal?.throwIfAborted();
      validateGeneration("generate_image", request);
      return transport<Quote>({
        method: "POST",
        path: "/v1/images/quotes",
        body: request,
        ...(options?.signal ? { signal: options.signal } : {}),
      }).then(value => validateQuoteResponse(value, request, "generate_image", localCatalog));
    },
    quoteBatch(requests, options) {
      options?.signal?.throwIfAborted();
      if (requests.length < 1 || requests.length > 20) throw new Error("quote_batch_request_invalid");
      return transport<unknown>({
        method: "POST",
        path: "/v1/quotes",
        body: { requests },
        ...(options?.signal ? { signal: options.signal } : {}),
      }).then(value => validateQuoteBatchResponse(value, requests, localCatalog));
    },
    submitImage(request, idempotencyKey, options) {
      options?.signal?.throwIfAborted();
      const key = idempotencyKey === undefined ? crypto.randomUUID() : idempotencyKey.trim();
      if (!key || (idempotencyKey !== undefined && /[\r\n]/.test(idempotencyKey))) throw new Error("idempotency_key_invalid");
      validateGeneration("generate_image", request);
      return Promise.resolve().then(() => transport<Job>({
        method: "POST",
        path: "/v1/images/generations",
        ...(options?.signal ? { signal: options.signal } : {}),
        headers: { "Idempotency-Key": key },
        body: request,
      })).then(validateSubmittedJob).catch(error => { throw submissionError(error, key); });
    },
    quoteVideo(request, options) {
      options?.signal?.throwIfAborted();
      validateGeneration("generate_video", request);
      return transport<Quote>({
        method: "POST",
        path: "/v1/videos/quotes",
        body: request,
        ...(options?.signal ? { signal: options.signal } : {}),
      }).then(value => validateQuoteResponse(value, request, "generate_video", localCatalog));
    },
    submitVideo(request, idempotencyKey, options) {
      options?.signal?.throwIfAborted();
      const key = idempotencyKey === undefined ? crypto.randomUUID() : idempotencyKey.trim();
      if (!key || (idempotencyKey !== undefined && /[\r\n]/.test(idempotencyKey))) throw new Error("idempotency_key_invalid");
      validateGeneration("generate_video", request);
      return Promise.resolve().then(() => transport<Job>({
        method: "POST",
        path: "/v1/videos/generations",
        ...(options?.signal ? { signal: options.signal } : {}),
        headers: { "Idempotency-Key": key },
        body: request,
      })).then(validateSubmittedJob).catch(error => { throw submissionError(error, key); });
    },
    quoteMusic(request, options) {
      options?.signal?.throwIfAborted();
      validateGeneration("generate_music", request);
      return transport<Quote>({
        method: "POST",
        path: "/v1/music/quotes",
        body: request,
        ...(options?.signal ? { signal: options.signal } : {}),
      }).then(value => validateQuoteResponse(value, request, "generate_music", localCatalog));
    },
    submitMusic(request, idempotencyKey, options) {
      options?.signal?.throwIfAborted();
      const key = idempotencyKey === undefined ? crypto.randomUUID() : idempotencyKey.trim();
      if (!key || (idempotencyKey !== undefined && /[\r\n]/.test(idempotencyKey))) throw new Error("idempotency_key_invalid");
      validateGeneration("generate_music", request);
      return Promise.resolve().then(() => transport<Job>({
        method: "POST",
        path: "/v1/music/generations",
        ...(options?.signal ? { signal: options.signal } : {}),
        headers: { "Idempotency-Key": key },
        body: request,
      })).then(validateSubmittedJob).catch(error => { throw submissionError(error, key); });
    },
    getJob(id, options) {
      options?.signal?.throwIfAborted();
      const normalizedID = id.trim();
      if (!isValidJobID(normalizedID)) throw new Error("job_id_invalid");
      const request: { method: "GET"; path: string; signal?: AbortSignal } = {
        method: "GET",
        path: `/v1/jobs/${normalizedID}`,
      };
      if (options?.signal !== undefined) {
        request.signal = options.signal;
      }
      return transport<Job>(request).then(job => {
        if (typeof job !== "object" || job === null || job.id !== normalizedID || !validJobStatus(job.status)) {
          throw new Error("response_invalid");
        }
        return job;
      });
    },
    getJobStatus(id, options) {
      options?.signal?.throwIfAborted();
      const normalizedID = id.trim();
      if (!isValidJobID(normalizedID)) throw new Error("job_id_invalid");
      const waitSeconds = options?.waitSeconds ?? 0;
      if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > MAX_STATUS_WAIT_SECONDS) {
        throw new Error("wait_invalid");
      }
      const request: { method: "GET"; path: string; signal?: AbortSignal; holdMs?: number } = {
        method: "GET",
        path: `/v1/jobs/${normalizedID}/status${waitSeconds > 0 ? `?wait=${waitSeconds}` : ""}`,
      };
      if (waitSeconds > 0) {
        request.holdMs = waitSeconds * 1000;
      }
      if (options?.signal !== undefined) {
        request.signal = options.signal;
      }
      return transport<JobStatusResponse>(request).then(status => {
        if (typeof status !== "object" || status === null || status.id !== normalizedID || !validJobStatus(status.status)) {
          throw new Error("response_invalid");
        }
        return status;
      });
    },
    cancelJob(id, options) {
      options?.signal?.throwIfAborted();
      const normalizedID = id.trim();
      if (!isValidJobID(normalizedID)) throw new Error("job_id_invalid");
      return transport<Job>({
        method: "POST",
        path: `/v1/jobs/${normalizedID}/cancel`,
        ...(options?.signal ? { signal: options.signal } : {}),
      }).then(job => {
        if (typeof job !== "object" || job === null || job.id !== normalizedID || !validJobStatus(job.status)) {
          throw new Error("response_invalid");
        }
        return job;
      });
    },
  };
}

export const DEFAULT_GATEWAY_BASE_URL = "https://gateway.yir.ai";

// The build derives PACKAGE_VERSION from package.json; tests enforce parity.
export const DEFAULT_USER_AGENT = `@yir-ai/sdk/${PACKAGE_VERSION}`;
export const DEFAULT_POLL_TIMEOUT_MS = 300000;
/** Consecutive 429 responses `waitForJob` waits out before throwing. */
const MAX_RATE_LIMIT_RETRIES = 5;
/** Default long-poll hold of `waitForJob` status queries. */
export const DEFAULT_STATUS_WAIT_SECONDS = 20;
/** The Gateway's cap for the status `wait` query parameter. */
export const MAX_STATUS_WAIT_SECONDS = 30;
/** Default per-request limit of the Node transport, matching the Go SDK's HTTP client. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

// The timeout also covers reading the response body, which shares this signal.
function requestSignal(signal: AbortSignal | undefined, timeoutMs: number, holdMs = 0): AbortSignal | undefined {
  if (timeoutMs === 0 || timeoutMs === Infinity) return signal;
  const timeout = AbortSignal.timeout(timeoutMs + holdMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Same check as the Go SDK. An invalid body after a submit is an unknown
// outcome: recover with the same request and idempotency key.
function validateSubmittedJob(job: Job): Job {
  if (typeof job !== "object" || job === null || !isValidJobID(job.id) || !validJobStatus(job.status)) {
    throw new Error("response_invalid");
  }
  return job;
}

/**
 * Job IDs are opaque; any non-empty ID that is safe as one URL path segment is
 * accepted, so a new server ID format needs no SDK release.
 */
export function isValidJobID(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id !== "." && id !== ".." && id.length <= 64 && !/[\s/?#%\\\u0000-\u001f\u007f]/.test(id);
}

export const TERMINAL_JOB_STATUSES = Object.freeze(["succeeded", "failed", "cancelled"] as const);

// Statuses newer than this SDK are accepted as in progress, so waitForJob keeps
// polling and a newer status never hides an accepted Job ID.
function validJobStatus(status: unknown): status is JobStatus {
  return typeof status === "string" && status.trim() !== "";
}

/**
 * Recommended delay after a status query for one Job. `poll` is the zero-based index
 * of the query that just completed (0 after the first):
 * 5s for the first 30 seconds, 10s until about 90 seconds, then 20s.
 * Durable workflows can reuse it with their own timers.
 */
export function pollDelayMs(poll: number): number {
  if (poll < 6) return 5000;
  if (poll < 12) return 10000;
  return 20000;
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export class YirAPIError extends Error {
  /** Present when this error came from a submit. Not included in log/JSON serialization. */
  declare readonly idempotencyKey?: string;
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly action?: YirErrorAction;
  readonly requestId?: string;
  readonly details?: unknown;
  /** Retry-After delay of a 429 `YIR_RATE_LIMITED` response, when present. */
  readonly retryAfterMs?: number;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    retryable?: boolean;
    action?: YirErrorAction;
    requestId?: string;
    details?: unknown;
    retryAfterMs?: number;
  }) {
    super(params.message);
    this.name = "YirAPIError";
    this.status = params.status;
    // Same fallback as the Go SDK; the HTTP status stays in `status`.
    this.code = params.code || "http_error";
    this.retryable = params.retryable ?? false;
    this.action = params.action;
    this.requestId = params.requestId;
    this.details = params.details;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export class YirJobError extends Error {
  readonly job: Job;
  readonly code: string;
  readonly action?: YirErrorAction;
  readonly retryable: boolean;

  constructor(job: Job) {
    const providerError = job.error?.provider_error;
    const detail = (job.error?.message ?? (job.status === "cancelled" ? "Job was cancelled" : "Job execution failed"))
      + (providerError ? ` (${providerError.provider}: ${providerError.message})` : "");
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
  readonly lastStatus?: JobStatusResponse;

  constructor(jobId: string, timeoutMs: number, lastStatus?: JobStatusResponse) {
    super(`Timed out after ${timeoutMs}ms waiting for job ${jobId}`);
    this.name = "YirTimeoutError";
    this.jobId = jobId;
    this.timeoutMs = timeoutMs;
    this.lastStatus = lastStatus;
  }
}

export type WaitForJobOptions = {
  /**
   * Fixed interval in milliseconds between polling attempts.
   * Defaults to the `pollDelayMs` backoff (5s, then 10s, then 20s).
   */
  readonly pollIntervalMs?: number;
  /**
   * Seconds the Gateway may hold each status query until the status changes.
   * Defaults to 20; 0 disables long polling and uses only `pollIntervalMs`/backoff.
   */
  readonly statusWaitSeconds?: number;
  /**
   * Maximum wait time in milliseconds before timing out.
   * Defaults to 300000 (5 minutes). Set to 0 or Infinity to disable timeout.
   */
  readonly timeoutMs?: number;
  /**
   * Callback invoked immediately after each poll response is received.
   */
  readonly onPoll?: (status: JobStatusResponse) => void | Promise<void>;
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
  client: Pick<YirClient, "getJob" | "getJobStatus">,
  jobId: string,
  options: WaitForJobOptions = {},
): Promise<Job> {
  const normalizedID = jobId.trim();
  if (!isValidJobID(normalizedID)) throw new Error("job_id_invalid");

  const fixedInterval = options.pollIntervalMs;
  if (fixedInterval !== undefined && !(fixedInterval > 0)) throw new Error("poll_interval_invalid");
  const statusWaitSeconds = options.statusWaitSeconds ?? DEFAULT_STATUS_WAIT_SECONDS;
  if (!Number.isInteger(statusWaitSeconds) || statusWaitSeconds < 0) throw new Error("wait_invalid");

  const timeout = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const hasTimeout = typeof timeout === "number" && timeout > 0 && Number.isFinite(timeout);
  const throwOnFailure = options.throwOnFailure ?? true;
  const startTime = Date.now();

  let lastStatus: JobStatusResponse | undefined;
  let limited = 0;

  for (let poll = 0; ; poll += 1) {
    const interval = fixedInterval ?? pollDelayMs(poll);
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("aborted");
    }

    if (hasTimeout && Date.now() - startTime >= timeout) {
      throw new YirTimeoutError(normalizedID, timeout, lastStatus);
    }

    const remaining = hasTimeout ? timeout - (Date.now() - startTime) : undefined;
    // Keep the hold inside the caller's timeout so it never ends mid-request.
    const waitSeconds = Math.max(0, Math.min(
      statusWaitSeconds, MAX_STATUS_WAIT_SECONDS,
      remaining === undefined ? MAX_STATUS_WAIT_SECONDS : Math.floor(remaining / 1000) - 1,
    ));
    const previous = lastStatus;
    const requestedAt = Date.now();
    let status: JobStatusResponse;
    try {
      status = await getJobStatusWithDeadline(client, normalizedID, options.signal, remaining, timeout, lastStatus, waitSeconds);
    } catch (error) {
      // Wait out a 429 per Retry-After (default 1s, capped at 60s), at most
      // MAX_RATE_LIMIT_RETRIES times in a row; the timeout check above still applies.
      if (!(error instanceof YirAPIError) || error.status !== 429 || limited >= MAX_RATE_LIMIT_RETRIES) throw error;
      limited += 1;
      poll -= 1;
      const pause = Math.min(error.retryAfterMs ?? 1000, 60000);
      await sleep(remaining === undefined ? pause : Math.max(0, Math.min(pause, remaining)), options.signal);
      continue;
    }
    limited = 0;
    lastStatus = status;

    if (options.onPoll) {
      await options.onPoll(status);
    }

    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("aborted");
    }

    if (hasTimeout && Date.now() - startTime >= timeout) {
      throw new YirTimeoutError(normalizedID, timeout, lastStatus);
    }

    if (isTerminalJobStatus(status.status)) {
      const remainingForDetail = hasTimeout ? timeout - (Date.now() - startTime) : undefined;
      if (hasTimeout && (remainingForDetail === undefined || remainingForDetail <= 0)) {
        throw new YirTimeoutError(normalizedID, timeout, lastStatus);
      }
      const job = await getJobWithDeadline(client, normalizedID, options.signal, remainingForDetail, timeout, lastStatus);
      if (hasTimeout && Date.now() - startTime >= timeout) {
        throw new YirTimeoutError(normalizedID, timeout, lastStatus);
      }
      if (job.status !== status.status || !isTerminalJobStatus(job.status)) {
        throw new Error(
          `job_state_inconsistent: status summary reported '${status.status}' but job detail returned '${job.status}'`,
        );
      }
      if (job.status === "succeeded") {
        return job;
      }
      if (throwOnFailure) {
        throw new YirJobError(job);
      }
      return job;
    }

    // A held query that returned on a change or after holding needs no extra
    // delay. A quick unchanged answer means the Gateway did not hold it.
    const changed = previous !== undefined && previous.status !== status.status;
    if (waitSeconds > 0 && (changed || Date.now() - requestedAt >= (waitSeconds * 1000) / 2)) {
      continue;
    }

    if (hasTimeout) {
      const elapsed = Date.now() - startTime;
      const remaining = timeout - elapsed;
      if (remaining <= 0) {
        throw new YirTimeoutError(normalizedID, timeout, lastStatus);
      }
      const sleepMs = Math.min(interval, remaining);
      await sleep(sleepMs, options.signal);
    } else {
      await sleep(interval, options.signal);
    }
  }
}

async function getJobStatusWithDeadline(
  client: Pick<YirClient, "getJobStatus">,
  jobId: string,
  signal: AbortSignal | undefined,
  remainingMs: number | undefined,
  timeoutMs: number,
  lastStatus: JobStatusResponse | undefined,
  waitSeconds: number,
): Promise<JobStatusResponse> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortFromCaller = () => controller.abort(signal?.reason ?? new Error("aborted"));
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (remainingMs !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new YirTimeoutError(jobId, timeoutMs, lastStatus));
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
    const statusOptions = waitSeconds > 0 ? { signal: controller.signal, waitSeconds } : { signal: controller.signal };
    return await Promise.race([retryJobRead(() => client.getJobStatus(jobId, statusOptions), controller.signal), aborted]);
  } catch (error) {
    if (timedOut) throw new YirTimeoutError(jobId, timeoutMs, lastStatus);
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function getJobWithDeadline(
  client: Pick<YirClient, "getJob">,
  jobId: string,
  signal: AbortSignal | undefined,
  remainingMs: number | undefined,
  timeoutMs: number,
  lastStatus: JobStatusResponse | undefined,
): Promise<Job> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortFromCaller = () => controller.abort(signal?.reason ?? new Error("aborted"));
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (remainingMs !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new YirTimeoutError(jobId, timeoutMs, lastStatus));
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
    return await Promise.race([retryJobRead(() => client.getJob(jobId, { signal: controller.signal }), controller.signal), aborted]);
  } catch (error) {
    if (timedOut) throw new YirTimeoutError(jobId, timeoutMs, lastStatus);
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

// A transport retry budget is per request; waiting for an accepted Job has its
// own deadline. Recover reads only, including the final detail read.
async function retryJobRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await read();
    } catch (error) {
      signal.throwIfAborted();
      const transient = error instanceof YirAPIError
        ? [502, 503, 504].includes(error.status)
        : error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
      if (!transient) throw error;
      const hint = error instanceof YirAPIError ? error.retryAfterMs ?? 0 : 0;
      await sleep(Math.max(Math.min(1000 * 2 ** Math.min(attempt, 3), 5000), hint), signal);
    }
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
  /** Optional current API snapshot for additional local parameter validation. */
  readonly modelContracts?: ModelContractCatalog;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly userAgent?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Per-request limit in milliseconds for Gateway calls, matching the Go SDK's
   * 30-second default. 0 or Infinity disables it. A timed-out submit has an
   * unknown outcome: recover with the same request and idempotency key.
   */
  readonly timeoutMs?: number;
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (timeoutMs !== Infinity && !(Number.isInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 2147483647)) {
    throw new Error("timeout_invalid");
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

    const body = request.body !== undefined ? JSON.stringify(request.body) : undefined;
    const signal = requestSignal(request.signal, timeoutMs, request.holdMs);
    const canRetry = request.method === "GET" || (request.method === "POST" &&
      /^\/v1\/(images|videos|music)\/generations$/.test(path) &&
      Boolean(new Headers(headers).get("Idempotency-Key")?.trim()));
    let response: globalThis.Response;
    let text = "";
    for (let attempt = 0; ; attempt++) {
      try {
        response = await fetchFn(url, {
          method: request.method,
          headers,
          body,
          signal,
          // workerd supports manual/follow; never forward credentials to redirects.
          redirect: "manual",
        });
        if (response.status < 300 || response.status >= 400) text = await response.text();
      } catch (error) {
        if (!canRetry || attempt >= 3 || signal?.aborted || !(error instanceof TypeError)) throw error;
        await sleep(500 * 2 ** attempt, signal);
        continue;
      }
      if (!canRetry || attempt >= 3 || ![502, 503, 504].includes(response.status)) break;
      const hint = response.headers.get("retry-after");
      const seconds = hint === null ? NaN : Number(hint);
      const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(hint ?? "") - Date.now();
      // Do not retry earlier than a server's long Retry-After instruction.
      if (retryAfter > 60000) break;
      await sleep(Math.max(500 * 2 ** attempt, retryAfter || 0), signal);
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      if (request.redirect === "manual") {
        return { status: response.status, location: response.headers.get("location") } as Response;
      }
      // Redirect bodies and Location may contain signed URLs; do not expose them in errors.
      throw new Error("unexpected_redirect");
    }

    const contentType = response.headers.get("content-type") ?? "";
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
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = Number(retryAfterHeader);
      const parsedRetryAfter = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000 : Date.parse(retryAfterHeader ?? "") - Date.now();
      const retryAfterMs = parsedRetryAfter > 0 ? parsedRetryAfter : undefined;
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
            retryAfterMs,
          });
        }
      }
      const message = typeof data === "string" && data.length > 0
        ? data
        : `API request failed with status ${response.status}`;
      throw new YirAPIError({
        message,
        status: response.status,
        requestId: typeof data === "object" && data !== null && typeof (data as { request_id?: unknown }).request_id === "string"
          ? (data as { request_id: string }).request_id : undefined,
        details: data,
        retryAfterMs,
      });
    }

    return data as Response;
  };
}

export function createNodeYirClient(options: CreateNodeYirClientOptions = {}): NodeYirClient {
  const transport = createNodeHttpTransport(options);
  const baseClient = createYirClient(transport, options.modelContracts);

  return {
    ...baseClient,
    waitForJob(jobId: string, waitOptions?: WaitForJobOptions) {
      return waitForJob(baseClient, jobId, waitOptions);
    },
  };
}
