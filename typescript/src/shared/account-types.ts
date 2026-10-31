// Generated from spec/account-openapi.json. Do not edit.
export type AccountResponse = {
  "code"?: number;
  "data"?: unknown;
  "message"?: string;
};

export type AccountUserAlertSetting = {
  "email_enabled"?: boolean;
};

export type AccountUpdateYIRUserAlertSetting = {
  "email_enabled": boolean;
};

export type AccountAnalyticsResult = {
  "coverage"?: AccountAnalyticsCoverage;
  "generated_at"?: string;
  "grouping"?: AccountAnalyticsGrouping;
  "options"?: AccountAnalyticsOptions;
  "series"?: Array<AccountAnalyticsBucket>;
  "summary"?: AccountAnalyticsSummary;
};

export type AccountAnalyticsCoverage = {
  "effective_from"?: string;
  "effective_to"?: string;
  "granularity"?: string;
  "requested_from"?: string;
  "requested_to"?: string;
  "retention_notice"?: string;
  "retention_truncated"?: boolean;
  "timezone"?: string;
};

export type AccountAnalyticsGrouping = {
  "dimension"?: string;
  "groups"?: Array<AccountAnalyticsGroup>;
  "other"?: AccountAnalyticsGroup;
  "other_groups"?: number;
};

export type AccountAnalyticsGroup = {
  "key"?: string;
  "label"?: string;
  "series"?: Array<AccountAnalyticsGroupPoint>;
  "succeeded_jobs"?: number;
  "total_charged_usd"?: string;
  "total_jobs"?: number;
};

export type AccountAnalyticsGroupPoint = {
  "succeeded_jobs"?: number;
  "total_charged_usd"?: string;
  "total_jobs"?: number;
};

export type AccountAnalyticsOptions = {
  "attempt_providers"?: Array<string>;
  "models"?: Array<string>;
};

export type AccountAnalyticsBucket = {
  "cancelled_jobs"?: number;
  "content_rejected_jobs"?: number;
  "duration_ms"?: AccountAnalyticsDurationStats;
  "end_time"?: string;
  "failed_jobs"?: number;
  "official_savings"?: AccountAnalyticsOfficialSavings;
  "start_time"?: string;
  "status_breakdown"?: AccountAnalyticsStatusBreakdown;
  "succeeded_jobs"?: number;
  "success_rate_denominator"?: number;
  "success_rate_percent"?: number;
  "total_charged_usd"?: string;
  "total_jobs"?: number;
  "unfinished_jobs"?: number;
};

export type AccountAnalyticsDurationStats = {
  "average_ms"?: number;
  "missing_samples"?: number;
  "p50_ms"?: number;
  "p95_ms"?: number;
  "valid_samples"?: number;
};

export type AccountAnalyticsOfficialSavings = {
  "comparable_jobs"?: number;
  "coverage_percent"?: number;
  "savings_percent"?: number;
  "savings_usd"?: string;
};

export type AccountAnalyticsStatusBreakdown = {
  "cancelled"?: number;
  "delivering"?: number;
  "failed"?: number;
  "queued"?: number;
  "running"?: number;
  "succeeded"?: number;
};

export type AccountAnalyticsSummary = {
  "cancelled_jobs"?: number;
  "content_rejected_jobs"?: number;
  "cost"?: AccountAnalyticsCostStats;
  "duration_ms"?: AccountAnalyticsDurationStats;
  "failed_jobs"?: number;
  "official_savings"?: AccountAnalyticsOfficialSavings;
  "status_breakdown"?: AccountAnalyticsStatusBreakdown;
  "succeeded_jobs"?: number;
  "success_rate_denominator"?: number;
  "success_rate_percent"?: number;
  "total_jobs"?: number;
  "unfinished_jobs"?: number;
};

export type AccountAnalyticsCostStats = {
  "average_succeeded_job_charge_usd"?: string;
  "currency"?: string;
  "known_charge_succeeded_jobs"?: number;
  "total_charged_usd"?: string;
  "unknown_charge_succeeded_jobs"?: number;
};

export type AccountTaskListResult = {
  "filter_options"?: AccountLogFilterOptions;
  "from"?: string;
  "generated_at"?: string;
  "items"?: Array<AccountTaskListItem>;
  "retention_notice"?: string;
  "retention_window_days"?: number;
  "series"?: AccountLogStatusSeries;
  "stats_unavailable"?: boolean;
  "summary"?: AccountLogStatusCounts;
  "timezone"?: string;
  "to"?: string;
  "total"?: number;
  "truncated_by_retention"?: boolean;
};

export type AccountLogFilterOptions = {
  "api_keys"?: Array<AccountLogAPIKeyOption>;
  "models"?: Array<string>;
  "providers"?: Array<string>;
};

export type AccountLogAPIKeyOption = {
  "id"?: string;
  "label"?: string;
};

export type AccountTaskListItem = {
  "api_key_id"?: string;
  "api_key_label"?: string;
  "attempt_count"?: number;
  "billing"?: AccountTaskBillingView;
  "completed_at"?: string;
  "core_model"?: string;
  "created_at"?: string;
  "duration_ms"?: number;
  "elapsed_ms"?: number;
  "error_category"?: string;
  "failure_recovered"?: boolean;
  "final_channel_variant"?: string;
  "final_channel_variant_label"?: string;
  "final_provider"?: string;
  "id"?: string;
  "latency_hint"?: AccountLogLatencyHint;
  "source"?: string;
  "spec_summary"?: string;
  "started_at"?: string;
  "status"?: string;
  "total_charged_by_yir"?: string;
  "updated_at"?: string;
};

export type AccountTaskBillingView = {
  "currency"?: string;
  "display_status"?: string;
  "total_charged_by_yir"?: string;
};

export type AccountLogLatencyHint = {
  "comparison"?: AccountLogLatencyComparison;
  "delivery_ms"?: number;
  "fallback_count"?: number;
  "kind"?: string;
};

export type AccountLogLatencyComparison = {
  "baseline_p95_ms"?: number;
  "baseline_sample_count"?: number;
  "from"?: string;
  "p95_ms"?: number;
  "sample_count"?: number;
  "to"?: string;
};

export type AccountLogStatusSeries = {
  "buckets"?: Array<AccountLogTimeBucket>;
  "granularity"?: string;
  "timezone"?: string;
};

export type AccountLogTimeBucket = {
  "cancelled"?: number;
  "content_rejected"?: number;
  "delivering"?: number;
  "end_time"?: string;
  "failed"?: number;
  "index"?: number;
  "queued"?: number;
  "running"?: number;
  "start_time"?: string;
  "succeeded"?: number;
  "success_rate_percent"?: number;
  "total"?: number;
  "unfinished"?: number;
};

export type AccountLogStatusCounts = {
  "cancelled"?: number;
  "content_rejected"?: number;
  "delivering"?: number;
  "failed"?: number;
  "queued"?: number;
  "running"?: number;
  "succeeded"?: number;
  "success_rate_percent"?: number;
  "total"?: number;
  "unfinished"?: number;
};

export type AccountTaskDetail = {
  "api_key_id"?: string;
  "api_key_label"?: string;
  "attempt_count"?: number;
  "attempts"?: Array<AccountLogAttemptView>;
  "billing"?: AccountTaskBillingView;
  "callbacks"?: Array<AccountCallbackView>;
  "cancellation"?: AccountLogCancellationView;
  "cancellation_action"?: string;
  "client_task_id"?: string;
  "completed_at"?: string;
  "core_model"?: string;
  "created_at"?: string;
  "credentials"?: Array<AccountLogCredentialView>;
  "duration_ms"?: number;
  "elapsed_ms"?: number;
  "error"?: AccountStandardV1Error;
  "error_category"?: string;
  "events"?: Array<AccountTaskEventView>;
  "failure_recovered"?: boolean;
  "final_channel_variant"?: string;
  "final_channel_variant_label"?: string;
  "final_provider"?: string;
  "financial_confirmation"?: AccountFinancialConfirmationView;
  "id"?: string;
  "input"?: AccountLogInputView;
  "input_transfers"?: Array<AccountInputTransferView>;
  "latency_hint"?: AccountLogLatencyHint;
  "lifecycle"?: AccountLogLifecycleView;
  "result"?: AccountStandardV1Result;
  "routing"?: AccountLogRoutingView;
  "source"?: string;
  "source_model"?: string;
  "source_path"?: string;
  "spec_summary"?: string;
  "started_at"?: string;
  "status"?: string;
  "total_charged_by_yir"?: string;
  "updated_at"?: string;
  "usage"?: Array<AccountUsageView>;
  "winning_attempt_id"?: string;
};

export type AccountLogAttemptView = {
  "accelerated"?: boolean;
  "channel_variant"?: string;
  "channel_variant_label"?: string;
  "charge"?: AccountLogAttemptChargeView;
  "completed_at"?: string;
  "created_at"?: string;
  "duration_ms"?: number;
  "error_category"?: string;
  "error_message"?: string;
  "id"?: string;
  "provider"?: string;
  "result_adopted"?: boolean;
  "role"?: string;
  "sequence"?: number;
  "started_at"?: string;
  "status"?: string;
  "updated_at"?: string;
  "usage"?: Array<AccountLogAttemptUsageView>;
};

export type AccountLogAttemptChargeView = {
  "amount"?: string;
  "amount_basis"?: AccountStandardV1AmountBasis;
  "billed_by"?: AccountStandardV1BilledBy;
  "currency"?: string;
  "status"?: AccountStandardV1ChargeStatus;
  "supply_type"?: AccountStandardV1SupplyType;
};

export type AccountStandardV1AmountBasis = "yir_price_rule";

export type AccountStandardV1BilledBy = "yir";

export type AccountStandardV1ChargeStatus = "settled" | "waived";

export type AccountStandardV1SupplyType = "managed";

export type AccountLogAttemptUsageView = {
  "kind"?: string;
  "unit"?: string;
  "value_decimal"?: string;
};

export type AccountCallbackView = {
  "attempt_count"?: number;
  "created_at"?: string;
  "delivered_at"?: string;
  "id"?: string;
  "last_status_code"?: number;
  "next_attempt_at"?: string;
  "status"?: string;
  "updated_at"?: string;
  "url"?: string;
};

export type AccountLogCancellationView = {
  "effect"?: string;
  "requested_at"?: string;
  "status"?: string;
};

export type AccountLogCredentialView = {
  "file_index"?: number;
  "model"?: string;
  "signer"?: string;
};

export type AccountStandardV1Error = {
  "action"?: AccountStandardV1ErrorAction;
  "code"?: AccountStandardV1ErrorCode;
  "details"?: Array<AccountStandardV1ErrorDetail>;
  "message"?: string;
  "provider_error"?: AccountStandardV1ProviderError;
  "retryable"?: boolean;
};

export type AccountStandardV1ErrorAction = "fix_request" | "modify_input" | "add_funds" | "retry_later" | "contact_support";

export type AccountStandardV1ErrorCode = "YIR_INVALID_REQUEST" | "YIR_UNAUTHORIZED" | "YIR_INVALID_ROUTING_OVERRIDE" | "YIR_ROUTING_OVERRIDE_NOT_ALLOWED" | "YIR_INSUFFICIENT_BALANCE" | "YIR_BUDGET_EXCEEDED" | "YIR_SPEND_LIMIT_EXCEEDED" | "YIR_JOB_NOT_FOUND" | "YIR_FILE_NOT_FOUND" | "YIR_FILE_NOT_READY" | "YIR_FILE_EXPIRED" | "YIR_MODEL_NOT_FOUND" | "YIR_IDEMPOTENCY_CONFLICT" | "YIR_JOB_NOT_CANCELLABLE" | "YIR_NO_EXECUTABLE_ROUTE" | "YIR_RATE_LIMITED" | "YIR_TEMPORARILY_UNAVAILABLE" | "YIR_EXECUTION_FAILED" | "YIR_INPUT_REJECTED" | "YIR_CONTENT_REJECTED" | "YIR_OUTCOME_TIMEOUT" | "YIR_RESULT_DELIVERY_FAILED" | "YIR_JOB_TIMEOUT" | "YIR_FIDELITY_EXCLUDED";

export type AccountStandardV1ErrorDetail = {
  "allowed"?: Array<string>;
  "expected"?: string;
  "field"?: string;
  "reason"?: string;
};

export type AccountStandardV1ProviderError = {
  "message"?: string;
  "provider"?: string;
};

export type AccountTaskEventView = {
  "attempt_id"?: string;
  "created_at"?: string;
  "event_type"?: string;
  "id"?: string;
  "occurred_at"?: string;
  "reason_code"?: string;
};

export type AccountFinancialConfirmationView = {
  "authorized_amount"?: string;
  "currency"?: string;
  "deadline_at"?: string;
  "held_amount"?: string;
  "settled_amount"?: string;
  "stage"?: string;
  "status"?: string;
};

export type AccountLogInputView = {
  "prompt"?: string;
  "prompt_length"?: number;
  "references"?: Array<AccountLogInputReferenceView>;
  "summary"?: AccountInputSummary;
};

export type AccountLogInputReferenceView = {
  "expires_at"?: string;
  "media_type"?: string;
  "role"?: string;
  "source"?: string;
  "url"?: string;
};

export type AccountInputSummary = {
  "explicit_parameters"?: Array<string>;
  "ignored_parameters"?: Array<string>;
  "reference_count"?: number;
  "specification"?: AccountCanonicalTaskSpecificationV2;
};

export type AccountCanonicalTaskSpecificationV2 = {
  "adaptive_duration"?: boolean;
  "aspect_ratio"?: string;
  "duration_seconds"?: number;
  "face_limit"?: number;
  "fps"?: number;
  "generate_audio"?: boolean;
  "ignore_quality"?: boolean;
  "image_search"?: boolean;
  "instrumental"?: boolean;
  "lyrics_optimizer"?: boolean;
  "output_count"?: number;
  "pbr"?: boolean;
  "quality_tier"?: string;
  "resolution"?: string;
  "return_last_frame"?: boolean;
  "seed"?: number;
  "size"?: string;
  "texture"?: string;
  "topology"?: string;
  "voice"?: string;
  "web_search"?: boolean;
};

export type AccountInputTransferView = {
  "attempt_count"?: number;
  "completed_at"?: string;
  "duration_ms"?: number;
  "error_code"?: string;
  "file_index"?: number;
  "media_kind"?: string;
  "r2_stage_duration_ms"?: number;
  "size_bytes"?: number;
  "source_download_duration_ms"?: number;
  "started_at"?: string;
  "status"?: string;
};

export type AccountLogLifecycleView = {
  "log_expires_at"?: string;
  "raw_content_state"?: AccountLogRawContentState;
  "raw_expires_at"?: string;
  "stage"?: string;
};

export type AccountLogRawContentState = "retained" | "cleanup_pending" | "purged";

export type AccountStandardV1Result = {
  "availability"?: AccountStandardV1ResultAvailability;
  "content_safety"?: AccountStandardV1ContentSafety;
  "files"?: Array<AccountStandardV1ResultFile>;
  "warnings"?: Array<string>;
};

export type AccountStandardV1ResultAvailability = "available" | "expired";

export type AccountStandardV1ContentSafety = {
  "checked_by"?: "provider" | "yir";
  "status"?: "passed" | "unchecked";
};

export type AccountStandardV1ResultFile = {
  "duration_ms"?: number;
  "expires_at"?: number;
  "faces"?: number;
  "fidelity"?: AccountStandardV1ResultFidelity;
  "height"?: number;
  "media_type"?: string;
  "swap_checks"?: AccountPersonSwapChecks;
  "url"?: string;
  "width"?: number;
};

export type AccountStandardV1ResultFidelity = {
  "grade"?: "original" | "app" | "equivalent" | "altered" | "unverified";
  "reason"?: string;
};

export type AccountPersonSwapChecks = {
  "all_swapped"?: boolean;
  "passes"?: number;
  "slots"?: Array<AccountPersonSwapSlotCheck>;
  "threshold"?: number;
};

export type AccountPersonSwapSlotCheck = {
  "id"?: string;
  "similarity_to_original"?: number;
  "swapped"?: boolean;
};

export type AccountLogRoutingView = {
  "preference"?: string;
  "profile_id"?: string;
  "selection_reason"?: AccountLogRoutingSelectionReason;
};

export type AccountLogRoutingSelectionReason = "balanced" | "cost" | "speed" | "request_order" | "fallback";

export type AccountUsageView = {
  "attempt_id"?: string;
  "created_at"?: string;
  "evidence_status"?: string;
  "id"?: string;
  "kind"?: string;
  "observed_at"?: string;
  "provider"?: string;
  "unit"?: string;
  "value_decimal"?: string;
};

export type AccountRoutingProfileView = {
  "active_key_count"?: number;
  "allowed_model_patterns"?: Array<string>;
  "created_at"?: string;
  "default_accelerate"?: boolean;
  "default_fidelity"?: "original" | "genuine" | "any";
  "default_preference"?: string;
  "default_provider_order"?: Array<string>;
  "default_provider_order_strict"?: boolean;
  "excluded_model_patterns"?: Array<string>;
  "excluded_model_providers"?: Array<AccountRoutingModelProviderExclusion>;
  "excluded_providers"?: Array<string>;
  "fallback_enabled"?: boolean;
  "id"?: string;
  "is_default"?: boolean;
  "model_provider_orders"?: Array<AccountRoutingModelOrder>;
  "name"?: string;
  "updated_at"?: string;
  "version"?: number;
};

export type AccountRoutingModelProviderExclusion = {
  "model": string;
  "provider": string;
};

export type AccountRoutingModelOrder = {
  "canonical_model": string;
  "provider_order": Array<string>;
  "strict"?: boolean;
};

export type AccountCreateRoutingProfile = {
  "default_accelerate"?: boolean;
  "default_fidelity"?: "original" | "genuine" | "any";
  "default_preference"?: "balanced" | "cost" | "speed";
  "fallback_enabled"?: boolean;
  "name": string;
};

export type AccountUpdateRoutingProfile = {
  "allowed_model_patterns"?: Array<string>;
  "default_accelerate"?: boolean;
  "default_fidelity"?: "original" | "genuine" | "any";
  "default_preference"?: "balanced" | "cost" | "speed";
  "excluded_model_patterns"?: Array<string>;
  "excluded_model_providers"?: Array<AccountRoutingModelProviderExclusion>;
  "excluded_providers"?: Array<string>;
  "fallback_enabled"?: boolean;
  "name"?: string;
};

export type AccountLowBalanceAlertSetting = {
  "currency"?: string;
  "enabled"?: boolean;
  "is_default"?: boolean;
  "threshold"?: string;
  "triggered_at"?: string;
};

export type AccountUpdateLowBalanceAlertSetting = {
  "enabled": boolean;
  "threshold": string;
};

export type AccountWebhookEndpointListResult = {
  "items"?: Array<AccountWebhookEndpointView>;
};

export type AccountWebhookEndpointView = {
  "created_at"?: string;
  "description"?: string;
  "enabled"?: boolean;
  "events"?: string;
  "failed_deliveries"?: number;
  "id"?: string;
  "last_delivery_at"?: string;
  "last_delivery_status"?: string;
  "successful_deliveries"?: number;
  "total_deliveries"?: number;
  "updated_at"?: string;
  "url"?: string;
};

export type AccountWebhookEndpointCreate = {
  "description"?: string;
  "url": string;
};

export type AccountWebhookEndpointUpdate = {
  "description"?: string;
  "enabled"?: boolean;
  "url"?: string;
};

export type AccountWebhookDeliveryListResult = {
  "has_more"?: boolean;
  "items"?: Array<AccountWebhookDeliveryView>;
  "total"?: number;
};

export type AccountWebhookDeliveryView = {
  "attempt_count"?: number;
  "created_at"?: string;
  "delivered_at"?: string;
  "event"?: string;
  "event_id"?: string;
  "id"?: string;
  "last_error"?: string;
  "last_status_code"?: number;
  "next_attempt_at"?: string;
  "status"?: string;
  "task_id"?: string;
  "updated_at"?: string;
  "url"?: string;
  "url_host"?: string;
};

