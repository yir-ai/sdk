import type { ParameterNotice } from "./parameter-rules.js";
import type { StandardImageQuoteRequest, StandardVideoQuoteRequest } from "./standard.js";

export type JobStatus = "queued" | "running" | "delivering" | "succeeded" | "failed" | "cancelled";

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
  "YIR_OUTCOME_TIMEOUT",
  "YIR_RESULT_DELIVERY_FAILED",
] as const);

/** Stable public error codes. `YirPublicError.code` stays `string` so newer server codes still parse. */
export type YirErrorCode = (typeof YIR_ERROR_CODES)[number];

export type YirPublicError = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly action?: "fix_request" | "add_funds" | "retry_later" | "contact_support";
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
  readonly urls?: { readonly get: string; readonly cancel: string };
  readonly usage?: { readonly outputs: number };
  readonly cancellation?: JobCancellation;
  readonly result?:
    | { readonly availability: "available"; readonly files: readonly JobResultFile[]; readonly warnings?: readonly "additional_results_unavailable"[] }
    | { readonly availability: "expired"; readonly warnings?: readonly "additional_results_unavailable"[] };
  readonly billing?: {
    readonly official_comparison?: { readonly baseline_amount: string; readonly savings_amount: string; readonly source_url?: string };
    readonly currency: "USD";
    readonly total_charged_by_yir: string;
	readonly billing_mode?: "actual";
    readonly max_cost?: string;
    readonly compute_charges: readonly ComputeCharge[];
    readonly gateway_fee: { readonly amount: string; readonly status: "settled" | "waived" };
    readonly savings?: {
      readonly amount: string;
      readonly kind: "actual" | "estimated";
      readonly baseline_amount: string;
      readonly actual_user_charge: string;
    };
  };
  readonly error: YirPublicError | null;
  readonly created_at: number;
  readonly completed_at?: number;
};

export type QuotePrice =
  | { readonly kind: "fixed"; readonly amount: string }
  | { readonly kind: "estimate"; readonly amount: string; readonly estimate: { readonly scope: "output_only"; readonly quality?: string; readonly aspect_ratio?: string } & ({ readonly output_tokens: number; readonly output_megapixels?: never } | { readonly output_megapixels: number; readonly output_tokens?: never }) }
  | { readonly kind: "unavailable"; readonly amount: null; readonly reason: string };

export type Quote = {
	readonly billing_mode?: "actual";
  readonly parameter_notices?: readonly ParameterNotice[];
  readonly parameter_handling_may_vary?: boolean;
  readonly supply: { readonly available: boolean; readonly requires_max_cost: boolean; readonly issues: readonly string[] };
  readonly primary: QuotePrice;
  readonly max: QuotePrice;
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
  readonly parameters: {
    readonly duration: number;
    readonly resolution: string;
    readonly aspect_ratio: string;
    readonly generate_audio: boolean;
    readonly quality?: string;
    readonly n: number;
    readonly return_last_frame?: boolean;
    readonly web_search?: boolean;
    readonly image_search?: boolean;
  };
  readonly currency: "USD";
  readonly single_attempt_upper_bound: string | null;
  readonly has_verifiable_upper_bound: boolean;
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
