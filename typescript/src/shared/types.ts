import type { ParameterNotice } from "./parameter-rules.js";
import type { StandardImageQuoteRequest, StandardVideoQuoteRequest } from "./standard.js";

/** Statuses newer than this SDK are in progress; only succeeded, failed and cancelled are terminal. */
export type JobStatus = "queued" | "running" | "delivering" | "succeeded" | "failed" | "cancelled" | (string & {});

export const YIR_ERROR_CODES = Object.freeze([
  "YIR_INVALID_REQUEST",
  "YIR_UNAUTHORIZED",
  "YIR_INVALID_ROUTING_OVERRIDE",
  "YIR_ROUTING_OVERRIDE_NOT_ALLOWED",
  "YIR_INSUFFICIENT_BALANCE",
  "YIR_BUDGET_EXCEEDED",
  "YIR_SPEND_LIMIT_EXCEEDED",
  "YIR_JOB_NOT_FOUND",
  "YIR_FILE_NOT_FOUND",
  "YIR_FILE_NOT_READY",
  "YIR_FILE_EXPIRED",
  "YIR_MODEL_NOT_FOUND",
  "YIR_IDEMPOTENCY_CONFLICT",
  "YIR_JOB_NOT_CANCELLABLE",
  "YIR_NO_EXECUTABLE_ROUTE",
  "YIR_RATE_LIMITED",
  "YIR_TEMPORARILY_UNAVAILABLE",
  "YIR_EXECUTION_FAILED",
  "YIR_CONTENT_REJECTED",
  "YIR_OUTCOME_TIMEOUT",
  "YIR_RESULT_DELIVERY_FAILED",
  "YIR_JOB_TIMEOUT",
] as const);

/** Stable public error codes. `YirPublicError.code` stays `string` so newer server codes still parse. */
export type YirErrorCode = (typeof YIR_ERROR_CODES)[number];

/** Suggested next step. Actions newer than this SDK still parse; compare known values and keep a default branch. */
export type YirErrorAction = "fix_request" | "modify_input" | "add_funds" | "retry_later" | "contact_support" | (string & {});

/** One invalid request field. `reason` is a stable code; newer reasons may appear. */
export type YirErrorDetail = {
  readonly field: string;
  readonly reason: "invalid_body" | "unknown_field" | "wrong_type" | "required" | "unsupported" | "not_allowed" | "invalid" | "retired" | (string & {});
  /** Contract values the field accepts; for a retired model, its replacement. */
  readonly allowed?: readonly string[];
  readonly expected?: string;
};

export type YirPublicError = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly action?: YirErrorAction;
  /** Field-level causes of YIR_INVALID_REQUEST, for correcting the request without parsing `message`. */
  readonly details?: readonly YirErrorDetail[];
};

export type JobCancellation = {
  readonly status: "cancelled" | "stop_requested";
  readonly effect?: "stop_future_attempts";
  readonly requested_at: number;
};

export type JobStatusResponse = {
  readonly id: string;
  readonly status: JobStatus;
  readonly error: YirPublicError | null;
  readonly cancellation?: JobCancellation;
};

export type JobResultFile = {
  readonly url: string;
  readonly media_type: string;
  readonly width?: number;
  readonly height?: number;
  readonly expires_at: number;
};

/** NSFW check outcome for a delivered result; absent on historical results. */
export type JobResultContentSafety =
  | { readonly status: "passed"; readonly checked_by: "provider" | "yir" }
  | { readonly status: "unchecked" };

export type ComputeCharge = {
  readonly supply_type: "managed";
  readonly billed_by: "yir";
  readonly amount: string;
  readonly amount_basis: "yir_price_rule";
  readonly status: "settled" | "waived";
  readonly usage?: readonly {
    readonly metric: string;
    readonly quantity: string;
    readonly unit: string;
  }[];
};

export type Job = {
  readonly parameter_notices?: readonly ParameterNotice[];
  readonly final_provider?: string;
  readonly id: string;
  readonly object: "job";
  readonly status: JobStatus;
  readonly model: string;
  /** The normalized parameters the Job executes with, in the quote echo shape; absent only when the input summary is gone. */
  readonly parameters?: QuoteParameters;
  readonly urls?: { readonly get: string; readonly cancel: string };
  readonly usage?: { readonly outputs: number };
  readonly cancellation?: JobCancellation;
  readonly result?:
    | { readonly availability: "available"; readonly files: readonly JobResultFile[]; readonly warnings?: readonly "additional_results_unavailable"[]; readonly content_safety?: JobResultContentSafety }
    | { readonly availability: "expired"; readonly warnings?: readonly "additional_results_unavailable"[]; readonly content_safety?: JobResultContentSafety };
  readonly billing?: {
    readonly official_comparison?: { readonly baseline_amount: string; readonly savings_amount: string; readonly source_url?: string };
    readonly currency: "USD";
    readonly total_charged_by_yir: string;
	readonly billing_mode?: "actual";
    readonly max_cost?: string;
    readonly compute_charges: readonly ComputeCharge[];
    readonly gateway_fee: { readonly amount: string; readonly status: "settled" | "waived" };
  };
  readonly error: YirPublicError | null;
  readonly created_at: number;
  readonly completed_at?: number;
};

export type QuotePrice =
  | { readonly kind: "fixed"; readonly amount: string }
  | { readonly kind: "estimate"; readonly amount: string; readonly estimate: { readonly scope: "output_only" | (string & {}); readonly quality?: string; readonly aspect_ratio?: string } & ({ readonly output_tokens: number; readonly output_megapixels?: never } | { readonly output_megapixels: number; readonly output_tokens?: never }) }
  | { readonly kind: "unavailable"; readonly amount: null; readonly reason: string }
  /** A price kind newer than this SDK; the amount is still a validated decimal or null. */
  | { readonly kind: string & {}; readonly amount: string | null; readonly reason?: string };

/**
 * The normalized parameters a request resolves to: every parameter the model
 * contract declares for the operation, at its contract spelling, with omitted
 * parameters at their published default. Parameters the model does not declare
 * are absent: an image echo has no duration and a silent video model has no
 * generate_audio. Model-specific parameters are echoed under their contract names.
 */
export type QuoteParameters = {
  readonly resolution: string;
  readonly aspect_ratio: string;
  readonly n: number;
  readonly duration?: number;
  readonly generate_audio?: boolean;
  readonly quality?: string;
  readonly return_last_frame?: boolean;
  readonly web_search?: boolean;
  readonly image_search?: boolean;
  readonly [name: string]: unknown;
};

export type Quote = {
	readonly billing_mode?: "actual";
  readonly parameter_notices?: readonly ParameterNotice[];
  readonly parameter_handling_may_vary?: boolean;
  readonly supply: { readonly available: boolean; readonly issues: readonly string[] };
  readonly primary: QuotePrice;
  readonly official: QuotePrice;
  readonly price_difference_percent?: {
    readonly min: number;
    readonly max: number;
    readonly reference_amount_micros?: number;
  };
  readonly object: "quote";
  readonly model: string;
  readonly operation: "generate_image" | "generate_video";
  readonly input_mode: "text" | "image" | "reference";
  readonly parameters: QuoteParameters;
  readonly currency: "USD";
  readonly expires_at: number;
};

export type QuoteBatchRequestItem =
  | { readonly operation: "generate_image"; readonly request: StandardImageQuoteRequest }
  | { readonly operation: "generate_video"; readonly request: StandardVideoQuoteRequest };

export type QuoteBatchItem =
  | { readonly index: number; readonly quote: Quote; readonly error?: never }
  | { readonly index: number; readonly error: YirPublicError; readonly quote?: never };

export type QuoteBatch = {
  readonly object: "quote_batch";
  readonly data: readonly QuoteBatchItem[];
  readonly request_id: string;
};
