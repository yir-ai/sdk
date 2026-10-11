// Generated from spec/account-openapi.json. Do not edit.
package yir

type AccountResponse struct {
	Code    *int64  `json:"code,omitempty"`
	Data    any     `json:"data,omitempty"`
	Message *string `json:"message,omitempty"`
}

type AccountUserAlertSetting struct {
	EmailEnabled *bool `json:"email_enabled,omitempty"`
}

type AccountUpdateYIRUserAlertSetting struct {
	EmailEnabled bool `json:"email_enabled"`
}

type AccountAnalyticsResult struct {
	Coverage    *AccountAnalyticsCoverage `json:"coverage,omitempty"`
	GeneratedAt *string                   `json:"generated_at,omitempty"`
	Grouping    *AccountAnalyticsGrouping `json:"grouping,omitempty"`
	Options     *AccountAnalyticsOptions  `json:"options,omitempty"`
	Series      *[]AccountAnalyticsBucket `json:"series,omitempty"`
	Summary     *AccountAnalyticsSummary  `json:"summary,omitempty"`
}

type AccountAnalyticsCoverage struct {
	EffectiveFrom      *string `json:"effective_from,omitempty"`
	EffectiveTo        *string `json:"effective_to,omitempty"`
	Granularity        *string `json:"granularity,omitempty"`
	RequestedFrom      *string `json:"requested_from,omitempty"`
	RequestedTo        *string `json:"requested_to,omitempty"`
	RetentionNotice    *string `json:"retention_notice,omitempty"`
	RetentionTruncated *bool   `json:"retention_truncated,omitempty"`
	Timezone           *string `json:"timezone,omitempty"`
}

type AccountAnalyticsGrouping struct {
	Dimension   *string                  `json:"dimension,omitempty"`
	Groups      *[]AccountAnalyticsGroup `json:"groups,omitempty"`
	Other       *AccountAnalyticsGroup   `json:"other,omitempty"`
	OtherGroups *int64                   `json:"other_groups,omitempty"`
}

type AccountAnalyticsGroup struct {
	Key             *string                       `json:"key,omitempty"`
	Label           *string                       `json:"label,omitempty"`
	Series          *[]AccountAnalyticsGroupPoint `json:"series,omitempty"`
	SucceededJobs   *int64                        `json:"succeeded_jobs,omitempty"`
	TotalChargedUsd *string                       `json:"total_charged_usd,omitempty"`
	TotalJobs       *int64                        `json:"total_jobs,omitempty"`
}

type AccountAnalyticsGroupPoint struct {
	SucceededJobs   *int64  `json:"succeeded_jobs,omitempty"`
	TotalChargedUsd *string `json:"total_charged_usd,omitempty"`
	TotalJobs       *int64  `json:"total_jobs,omitempty"`
}

type AccountAnalyticsOptions struct {
	AttemptProviders *[]string `json:"attempt_providers,omitempty"`
	Models           *[]string `json:"models,omitempty"`
}

type AccountAnalyticsBucket struct {
	CancelledJobs          *int64                           `json:"cancelled_jobs,omitempty"`
	ContentRejectedJobs    *int64                           `json:"content_rejected_jobs,omitempty"`
	DurationMs             *AccountAnalyticsDurationStats   `json:"duration_ms,omitempty"`
	EndTime                *string                          `json:"end_time,omitempty"`
	FailedJobs             *int64                           `json:"failed_jobs,omitempty"`
	OfficialSavings        *AccountAnalyticsOfficialSavings `json:"official_savings,omitempty"`
	StartTime              *string                          `json:"start_time,omitempty"`
	StatusBreakdown        *AccountAnalyticsStatusBreakdown `json:"status_breakdown,omitempty"`
	SucceededJobs          *int64                           `json:"succeeded_jobs,omitempty"`
	SuccessRateDenominator *int64                           `json:"success_rate_denominator,omitempty"`
	SuccessRatePercent     *float64                         `json:"success_rate_percent,omitempty"`
	TotalChargedUsd        *string                          `json:"total_charged_usd,omitempty"`
	TotalJobs              *int64                           `json:"total_jobs,omitempty"`
	UnfinishedJobs         *int64                           `json:"unfinished_jobs,omitempty"`
}

type AccountAnalyticsDurationStats struct {
	AverageMs      *int64 `json:"average_ms,omitempty"`
	MissingSamples *int64 `json:"missing_samples,omitempty"`
	P50Ms          *int64 `json:"p50_ms,omitempty"`
	P95Ms          *int64 `json:"p95_ms,omitempty"`
	ValidSamples   *int64 `json:"valid_samples,omitempty"`
}

type AccountAnalyticsOfficialSavings struct {
	ComparableJobs  *int64   `json:"comparable_jobs,omitempty"`
	CoveragePercent *float64 `json:"coverage_percent,omitempty"`
	SavingsPercent  *float64 `json:"savings_percent,omitempty"`
}

type AccountAnalyticsStatusBreakdown struct {
	Cancelled  *int64 `json:"cancelled,omitempty"`
	Delivering *int64 `json:"delivering,omitempty"`
	Failed     *int64 `json:"failed,omitempty"`
	Queued     *int64 `json:"queued,omitempty"`
	Running    *int64 `json:"running,omitempty"`
	Succeeded  *int64 `json:"succeeded,omitempty"`
}

type AccountAnalyticsSummary struct {
	CancelledJobs          *int64                           `json:"cancelled_jobs,omitempty"`
	ContentRejectedJobs    *int64                           `json:"content_rejected_jobs,omitempty"`
	Cost                   *AccountAnalyticsCostStats       `json:"cost,omitempty"`
	DurationMs             *AccountAnalyticsDurationStats   `json:"duration_ms,omitempty"`
	FailedJobs             *int64                           `json:"failed_jobs,omitempty"`
	OfficialSavings        *AccountAnalyticsOfficialSavings `json:"official_savings,omitempty"`
	StatusBreakdown        *AccountAnalyticsStatusBreakdown `json:"status_breakdown,omitempty"`
	SucceededJobs          *int64                           `json:"succeeded_jobs,omitempty"`
	SuccessRateDenominator *int64                           `json:"success_rate_denominator,omitempty"`
	SuccessRatePercent     *float64                         `json:"success_rate_percent,omitempty"`
	TotalJobs              *int64                           `json:"total_jobs,omitempty"`
	UnfinishedJobs         *int64                           `json:"unfinished_jobs,omitempty"`
}

type AccountAnalyticsCostStats struct {
	AverageSucceededJobChargeUsd *string `json:"average_succeeded_job_charge_usd,omitempty"`
	Currency                     *string `json:"currency,omitempty"`
	KnownChargeSucceededJobs     *int64  `json:"known_charge_succeeded_jobs,omitempty"`
	TotalChargedUsd              *string `json:"total_charged_usd,omitempty"`
	UnknownChargeSucceededJobs   *int64  `json:"unknown_charge_succeeded_jobs,omitempty"`
}

type AccountTaskListResult struct {
	FilterOptions        *AccountLogFilterOptions `json:"filter_options,omitempty"`
	From                 *string                  `json:"from,omitempty"`
	GeneratedAt          *string                  `json:"generated_at,omitempty"`
	Items                *[]AccountTaskListItem   `json:"items,omitempty"`
	RetentionNotice      *string                  `json:"retention_notice,omitempty"`
	RetentionWindowDays  *int64                   `json:"retention_window_days,omitempty"`
	Series               *AccountLogStatusSeries  `json:"series,omitempty"`
	StatsUnavailable     *bool                    `json:"stats_unavailable,omitempty"`
	Summary              *map[string]any          `json:"summary,omitempty"`
	Timezone             *string                  `json:"timezone,omitempty"`
	To                   *string                  `json:"to,omitempty"`
	Total                *int64                   `json:"total,omitempty"`
	TruncatedByRetention *bool                    `json:"truncated_by_retention,omitempty"`
}

type AccountLogFilterOptions struct {
	ApiKeys   *[]AccountLogAPIKeyOption `json:"api_keys,omitempty"`
	Models    *[]string                 `json:"models,omitempty"`
	Providers *[]string                 `json:"providers,omitempty"`
}

type AccountLogAPIKeyOption struct {
	Id    *string `json:"id,omitempty"`
	Label *string `json:"label,omitempty"`
}

type AccountTaskListItem struct {
	ApiKeyId                 *string                 `json:"api_key_id,omitempty"`
	ApiKeyLabel              *string                 `json:"api_key_label,omitempty"`
	AttemptCount             *int64                  `json:"attempt_count,omitempty"`
	Billing                  *AccountTaskBillingView `json:"billing,omitempty"`
	CompletedAt              *string                 `json:"completed_at,omitempty"`
	CoreModel                *string                 `json:"core_model,omitempty"`
	CreatedAt                *string                 `json:"created_at,omitempty"`
	DurationMs               *int64                  `json:"duration_ms,omitempty"`
	ElapsedMs                *int64                  `json:"elapsed_ms,omitempty"`
	ErrorCategory            *string                 `json:"error_category,omitempty"`
	FailureRecovered         *bool                   `json:"failure_recovered,omitempty"`
	FinalChannelVariant      *string                 `json:"final_channel_variant,omitempty"`
	FinalChannelVariantLabel *string                 `json:"final_channel_variant_label,omitempty"`
	FinalProvider            *string                 `json:"final_provider,omitempty"`
	Id                       *string                 `json:"id,omitempty"`
	LatencyHint              *AccountLogLatencyHint  `json:"latency_hint,omitempty"`
	Source                   *string                 `json:"source,omitempty"`
	SpecSummary              *string                 `json:"spec_summary,omitempty"`
	StartedAt                *string                 `json:"started_at,omitempty"`
	Status                   *string                 `json:"status,omitempty"`
	TotalChargedByYir        *string                 `json:"total_charged_by_yir,omitempty"`
	UpdatedAt                *string                 `json:"updated_at,omitempty"`
}

type AccountTaskBillingView struct {
	Currency          *string `json:"currency,omitempty"`
	DisplayStatus     *string `json:"display_status,omitempty"`
	TotalChargedByYir *string `json:"total_charged_by_yir,omitempty"`
}

type AccountLogLatencyHint struct {
	Comparison    *AccountLogLatencyComparison `json:"comparison,omitempty"`
	DeliveryMs    *int64                       `json:"delivery_ms,omitempty"`
	FallbackCount *int64                       `json:"fallback_count,omitempty"`
	Kind          *string                      `json:"kind,omitempty"`
}

type AccountLogLatencyComparison struct {
	BaselineP95Ms       *int64  `json:"baseline_p95_ms,omitempty"`
	BaselineSampleCount *int64  `json:"baseline_sample_count,omitempty"`
	From                *string `json:"from,omitempty"`
	P95Ms               *int64  `json:"p95_ms,omitempty"`
	SampleCount         *int64  `json:"sample_count,omitempty"`
	To                  *string `json:"to,omitempty"`
}

type AccountLogStatusSeries struct {
	Buckets     *[]AccountLogTimeBucket `json:"buckets,omitempty"`
	Granularity *string                 `json:"granularity,omitempty"`
	Timezone    *string                 `json:"timezone,omitempty"`
}

type AccountLogTimeBucket struct {
	Cancelled          *int64   `json:"cancelled,omitempty"`
	ContentRejected    *int64   `json:"content_rejected,omitempty"`
	Delivering         *int64   `json:"delivering,omitempty"`
	EndTime            *string  `json:"end_time,omitempty"`
	Failed             *int64   `json:"failed,omitempty"`
	Index              *int64   `json:"index,omitempty"`
	Queued             *int64   `json:"queued,omitempty"`
	Running            *int64   `json:"running,omitempty"`
	StartTime          *string  `json:"start_time,omitempty"`
	Succeeded          *int64   `json:"succeeded,omitempty"`
	SuccessRatePercent *float64 `json:"success_rate_percent,omitempty"`
	Total              *int64   `json:"total,omitempty"`
	Unfinished         *int64   `json:"unfinished,omitempty"`
}

type AccountLogStatusCounts struct {
	Cancelled          *int64   `json:"cancelled,omitempty"`
	ContentRejected    *int64   `json:"content_rejected,omitempty"`
	Delivering         *int64   `json:"delivering,omitempty"`
	Failed             *int64   `json:"failed,omitempty"`
	Queued             *int64   `json:"queued,omitempty"`
	Running            *int64   `json:"running,omitempty"`
	Succeeded          *int64   `json:"succeeded,omitempty"`
	SuccessRatePercent *float64 `json:"success_rate_percent,omitempty"`
	Total              *int64   `json:"total,omitempty"`
	Unfinished         *int64   `json:"unfinished,omitempty"`
}

type AccountTaskDetail struct {
	ApiKeyId                 *string                           `json:"api_key_id,omitempty"`
	ApiKeyLabel              *string                           `json:"api_key_label,omitempty"`
	AttemptCount             *int64                            `json:"attempt_count,omitempty"`
	Attempts                 *[]AccountLogAttemptView          `json:"attempts,omitempty"`
	Billing                  *AccountTaskBillingView           `json:"billing,omitempty"`
	Callbacks                *[]AccountCallbackView            `json:"callbacks,omitempty"`
	Cancellation             *AccountLogCancellationView       `json:"cancellation,omitempty"`
	CancellationAction       *string                           `json:"cancellation_action,omitempty"`
	ClientTaskId             *string                           `json:"client_task_id,omitempty"`
	CompletedAt              *string                           `json:"completed_at,omitempty"`
	CoreModel                *string                           `json:"core_model,omitempty"`
	CreatedAt                *string                           `json:"created_at,omitempty"`
	DurationMs               *int64                            `json:"duration_ms,omitempty"`
	ElapsedMs                *int64                            `json:"elapsed_ms,omitempty"`
	Error                    *AccountStandardV1Error           `json:"error,omitempty"`
	ErrorCategory            *string                           `json:"error_category,omitempty"`
	Events                   *[]AccountTaskEventView           `json:"events,omitempty"`
	FailureRecovered         *bool                             `json:"failure_recovered,omitempty"`
	FinalChannelVariant      *string                           `json:"final_channel_variant,omitempty"`
	FinalChannelVariantLabel *string                           `json:"final_channel_variant_label,omitempty"`
	FinalProvider            *string                           `json:"final_provider,omitempty"`
	FinancialConfirmation    *AccountFinancialConfirmationView `json:"financial_confirmation,omitempty"`
	Id                       *string                           `json:"id,omitempty"`
	Input                    *AccountLogInputView              `json:"input,omitempty"`
	InputTransfers           *[]AccountInputTransferView       `json:"input_transfers,omitempty"`
	LatencyHint              *AccountLogLatencyHint            `json:"latency_hint,omitempty"`
	Lifecycle                *AccountLogLifecycleView          `json:"lifecycle,omitempty"`
	Result                   *AccountStandardV1Result          `json:"result,omitempty"`
	Routing                  *AccountLogRoutingView            `json:"routing,omitempty"`
	Source                   *string                           `json:"source,omitempty"`
	SourceModel              *string                           `json:"source_model,omitempty"`
	SourcePath               *string                           `json:"source_path,omitempty"`
	SpecSummary              *string                           `json:"spec_summary,omitempty"`
	StartedAt                *string                           `json:"started_at,omitempty"`
	Status                   *string                           `json:"status,omitempty"`
	TotalChargedByYir        *string                           `json:"total_charged_by_yir,omitempty"`
	UpdatedAt                *string                           `json:"updated_at,omitempty"`
	Usage                    *[]AccountUsageView               `json:"usage,omitempty"`
	WinningAttemptId         *string                           `json:"winning_attempt_id,omitempty"`
}

type AccountLogAttemptView struct {
	Accelerated         *bool                         `json:"accelerated,omitempty"`
	ChannelVariant      *string                       `json:"channel_variant,omitempty"`
	ChannelVariantLabel *string                       `json:"channel_variant_label,omitempty"`
	Charge              *AccountLogAttemptChargeView  `json:"charge,omitempty"`
	CompletedAt         *string                       `json:"completed_at,omitempty"`
	CreatedAt           *string                       `json:"created_at,omitempty"`
	DurationMs          *int64                        `json:"duration_ms,omitempty"`
	ErrorCategory       *string                       `json:"error_category,omitempty"`
	Id                  *string                       `json:"id,omitempty"`
	Provider            *string                       `json:"provider,omitempty"`
	ResultAdopted       *bool                         `json:"result_adopted,omitempty"`
	Role                *string                       `json:"role,omitempty"`
	Sequence            *int64                        `json:"sequence,omitempty"`
	StartedAt           *string                       `json:"started_at,omitempty"`
	Status              *string                       `json:"status,omitempty"`
	UpdatedAt           *string                       `json:"updated_at,omitempty"`
	Usage               *[]AccountLogAttemptUsageView `json:"usage,omitempty"`
}

type AccountLogAttemptChargeView struct {
	Amount      *string                        `json:"amount,omitempty"`
	AmountBasis *AccountStandardV1AmountBasis  `json:"amount_basis,omitempty"`
	BilledBy    *AccountStandardV1BilledBy     `json:"billed_by,omitempty"`
	Currency    *string                        `json:"currency,omitempty"`
	Status      *AccountStandardV1ChargeStatus `json:"status,omitempty"`
	SupplyType  *AccountStandardV1SupplyType   `json:"supply_type,omitempty"`
}

type AccountStandardV1AmountBasis string

type AccountStandardV1BilledBy string

type AccountStandardV1ChargeStatus string

type AccountStandardV1SupplyType string

type AccountLogAttemptUsageView struct {
	Kind         *string `json:"kind,omitempty"`
	Unit         *string `json:"unit,omitempty"`
	ValueDecimal *string `json:"value_decimal,omitempty"`
}

type AccountCallbackView struct {
	AttemptCount   *int64  `json:"attempt_count,omitempty"`
	CreatedAt      *string `json:"created_at,omitempty"`
	DeliveredAt    *string `json:"delivered_at,omitempty"`
	Id             *string `json:"id,omitempty"`
	LastStatusCode *int64  `json:"last_status_code,omitempty"`
	NextAttemptAt  *string `json:"next_attempt_at,omitempty"`
	Status         *string `json:"status,omitempty"`
	UpdatedAt      *string `json:"updated_at,omitempty"`
	Url            *string `json:"url,omitempty"`
}

type AccountLogCancellationView struct {
	Effect      *string `json:"effect,omitempty"`
	RequestedAt *string `json:"requested_at,omitempty"`
	Status      *string `json:"status,omitempty"`
}

type AccountStandardV1Error struct {
	Action        *AccountStandardV1ErrorAction   `json:"action,omitempty"`
	Code          *AccountStandardV1ErrorCode     `json:"code,omitempty"`
	Details       *[]AccountStandardV1ErrorDetail `json:"details,omitempty"`
	Message       *string                         `json:"message,omitempty"`
	ProviderError *map[string]any                 `json:"provider_error,omitempty"`
	Retryable     *bool                           `json:"retryable,omitempty"`
}

type AccountStandardV1ErrorAction string

type AccountStandardV1ErrorCode string

type AccountStandardV1ErrorDetail struct {
	Allowed  *[]string `json:"allowed,omitempty"`
	Expected *string   `json:"expected,omitempty"`
	Field    *string   `json:"field,omitempty"`
	Reason   *string   `json:"reason,omitempty"`
}

type AccountStandardV1ProviderError struct {
	Message  *string `json:"message,omitempty"`
	Provider *string `json:"provider,omitempty"`
}

type AccountTaskEventView struct {
	AttemptId  *string `json:"attempt_id,omitempty"`
	CreatedAt  *string `json:"created_at,omitempty"`
	EventType  *string `json:"event_type,omitempty"`
	Id         *string `json:"id,omitempty"`
	OccurredAt *string `json:"occurred_at,omitempty"`
	ReasonCode *string `json:"reason_code,omitempty"`
}

type AccountFinancialConfirmationView struct {
	AuthorizedAmount *string `json:"authorized_amount,omitempty"`
	Currency         *string `json:"currency,omitempty"`
	DeadlineAt       *string `json:"deadline_at,omitempty"`
	HeldAmount       *string `json:"held_amount,omitempty"`
	SettledAmount    *string `json:"settled_amount,omitempty"`
	Stage            *string `json:"stage,omitempty"`
	Status           *string `json:"status,omitempty"`
}

type AccountLogInputView struct {
	Prompt       *string              `json:"prompt,omitempty"`
	PromptLength *int64               `json:"prompt_length,omitempty"`
	Summary      *AccountInputSummary `json:"summary,omitempty"`
}

type AccountInputSummary struct {
	ReferenceCount *int64                               `json:"reference_count,omitempty"`
	Specification  *AccountCanonicalTaskSpecificationV2 `json:"specification,omitempty"`
}

type AccountCanonicalTaskSpecificationV2 struct {
	AspectRatio     *string `json:"aspect_ratio,omitempty"`
	DurationSeconds *int64  `json:"duration_seconds,omitempty"`
	GenerateAudio   *bool   `json:"generate_audio,omitempty"`
	IgnoreQuality   *bool   `json:"ignore_quality,omitempty"`
	ImageSearch     *bool   `json:"image_search,omitempty"`
	OutputCount     *int64  `json:"output_count,omitempty"`
	QualityTier     *string `json:"quality_tier,omitempty"`
	Resolution      *string `json:"resolution,omitempty"`
	ReturnLastFrame *bool   `json:"return_last_frame,omitempty"`
	Seed            *int64  `json:"seed,omitempty"`
	WebSearch       *bool   `json:"web_search,omitempty"`
}

type AccountInputTransferView struct {
	AttemptCount             *int64  `json:"attempt_count,omitempty"`
	CompletedAt              *string `json:"completed_at,omitempty"`
	DurationMs               *int64  `json:"duration_ms,omitempty"`
	ErrorCode                *string `json:"error_code,omitempty"`
	FileIndex                *int64  `json:"file_index,omitempty"`
	MediaKind                *string `json:"media_kind,omitempty"`
	R2StageDurationMs        *int64  `json:"r2_stage_duration_ms,omitempty"`
	SizeBytes                *int64  `json:"size_bytes,omitempty"`
	SourceDownloadDurationMs *int64  `json:"source_download_duration_ms,omitempty"`
	StartedAt                *string `json:"started_at,omitempty"`
	Status                   *string `json:"status,omitempty"`
}

type AccountLogLifecycleView struct {
	LogExpiresAt    *string                    `json:"log_expires_at,omitempty"`
	RawContentState *AccountLogRawContentState `json:"raw_content_state,omitempty"`
	RawExpiresAt    *string                    `json:"raw_expires_at,omitempty"`
	Stage           *string                    `json:"stage,omitempty"`
}

type AccountLogRawContentState string

type AccountStandardV1Result struct {
	Availability  *map[string]any                 `json:"availability,omitempty"`
	ContentSafety *AccountStandardV1ContentSafety `json:"content_safety,omitempty"`
	Files         *[]AccountStandardV1ResultFile  `json:"files,omitempty"`
	Warnings      *[]string                       `json:"warnings,omitempty"`
}

type AccountStandardV1ResultAvailability string

type AccountStandardV1ContentSafety struct {
	CheckedBy *string `json:"checked_by,omitempty"`
	Status    *string `json:"status,omitempty"`
}

type AccountStandardV1ResultFile struct {
	ExpiresAt *int64          `json:"expires_at,omitempty"`
	Fidelity  *map[string]any `json:"fidelity,omitempty"`
	Height    *int64          `json:"height,omitempty"`
	MediaType *string         `json:"media_type,omitempty"`
	Url       *string         `json:"url,omitempty"`
	Width     *int64          `json:"width,omitempty"`
}

type AccountStandardV1ResultFidelity struct {
	Grade  *string `json:"grade,omitempty"`
	Reason *string `json:"reason,omitempty"`
}

type AccountLogRoutingView struct {
	Preference      *string                           `json:"preference,omitempty"`
	ProfileId       *string                           `json:"profile_id,omitempty"`
	SelectionReason *AccountLogRoutingSelectionReason `json:"selection_reason,omitempty"`
}

type AccountLogRoutingSelectionReason string

type AccountUsageView struct {
	AttemptId      *string `json:"attempt_id,omitempty"`
	CreatedAt      *string `json:"created_at,omitempty"`
	EvidenceStatus *string `json:"evidence_status,omitempty"`
	Id             *string `json:"id,omitempty"`
	Kind           *string `json:"kind,omitempty"`
	ObservedAt     *string `json:"observed_at,omitempty"`
	Provider       *string `json:"provider,omitempty"`
	Unit           *string `json:"unit,omitempty"`
	ValueDecimal   *string `json:"value_decimal,omitempty"`
}

type AccountRoutingProfileView struct {
	ActiveKeyCount             *int64                      `json:"active_key_count,omitempty"`
	AllowedModelPatterns       *[]string                   `json:"allowed_model_patterns,omitempty"`
	CreatedAt                  *string                     `json:"created_at,omitempty"`
	DefaultAccelerate          *bool                       `json:"default_accelerate,omitempty"`
	DefaultFidelity            *string                     `json:"default_fidelity,omitempty"`
	DefaultPreference          *string                     `json:"default_preference,omitempty"`
	DefaultProviderOrder       *[]string                   `json:"default_provider_order,omitempty"`
	DefaultProviderOrderStrict *bool                       `json:"default_provider_order_strict,omitempty"`
	ExcludedModelPatterns      *[]string                   `json:"excluded_model_patterns,omitempty"`
	ExcludedProviders          *[]string                   `json:"excluded_providers,omitempty"`
	FallbackEnabled            *bool                       `json:"fallback_enabled,omitempty"`
	Id                         *string                     `json:"id,omitempty"`
	IsDefault                  *bool                       `json:"is_default,omitempty"`
	ModelProviderOrders        *[]AccountRoutingModelOrder `json:"model_provider_orders,omitempty"`
	Name                       *string                     `json:"name,omitempty"`
	UpdatedAt                  *string                     `json:"updated_at,omitempty"`
	Version                    *int64                      `json:"version,omitempty"`
}

type AccountRoutingModelOrder struct {
	CanonicalModel string   `json:"canonical_model"`
	ProviderOrder  []string `json:"provider_order"`
	Strict         *bool    `json:"strict,omitempty"`
}

type AccountCreateRoutingProfile struct {
	DefaultAccelerate *bool   `json:"default_accelerate,omitempty"`
	DefaultFidelity   *string `json:"default_fidelity,omitempty"`
	DefaultPreference *string `json:"default_preference,omitempty"`
	FallbackEnabled   *bool   `json:"fallback_enabled,omitempty"`
	Name              string  `json:"name"`
}

type AccountUpdateRoutingProfile struct {
	AllowedModelPatterns  *[]string `json:"allowed_model_patterns,omitempty"`
	DefaultAccelerate     *bool     `json:"default_accelerate,omitempty"`
	DefaultFidelity       *string   `json:"default_fidelity,omitempty"`
	DefaultPreference     *string   `json:"default_preference,omitempty"`
	ExcludedModelPatterns *[]string `json:"excluded_model_patterns,omitempty"`
	ExcludedProviders     *[]string `json:"excluded_providers,omitempty"`
	FallbackEnabled       *bool     `json:"fallback_enabled,omitempty"`
	Name                  *string   `json:"name,omitempty"`
}

type AccountLowBalanceAlertSetting struct {
	Currency    *string `json:"currency,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`
	IsDefault   *bool   `json:"is_default,omitempty"`
	Threshold   *string `json:"threshold,omitempty"`
	TriggeredAt *string `json:"triggered_at,omitempty"`
}

type AccountUpdateLowBalanceAlertSetting struct {
	Enabled   bool   `json:"enabled"`
	Threshold string `json:"threshold"`
}

type AccountWebhookEndpointListResult struct {
	Items *[]AccountWebhookEndpointView `json:"items,omitempty"`
}

type AccountWebhookEndpointView struct {
	CreatedAt            *string `json:"created_at,omitempty"`
	Description          *string `json:"description,omitempty"`
	Enabled              *bool   `json:"enabled,omitempty"`
	Events               *string `json:"events,omitempty"`
	FailedDeliveries     *int64  `json:"failed_deliveries,omitempty"`
	Id                   *string `json:"id,omitempty"`
	LastDeliveryAt       *string `json:"last_delivery_at,omitempty"`
	LastDeliveryStatus   *string `json:"last_delivery_status,omitempty"`
	SuccessfulDeliveries *int64  `json:"successful_deliveries,omitempty"`
	TotalDeliveries      *int64  `json:"total_deliveries,omitempty"`
	UpdatedAt            *string `json:"updated_at,omitempty"`
	Url                  *string `json:"url,omitempty"`
}

type AccountWebhookEndpointCreate struct {
	Description *string `json:"description,omitempty"`
	Url         string  `json:"url"`
}

type AccountWebhookEndpointUpdate struct {
	Description *string `json:"description,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`
	Url         *string `json:"url,omitempty"`
}

type AccountWebhookDeliveryListResult struct {
	HasMore *bool                         `json:"has_more,omitempty"`
	Items   *[]AccountWebhookDeliveryView `json:"items,omitempty"`
	Total   *int64                        `json:"total,omitempty"`
}

type AccountWebhookDeliveryView struct {
	AttemptCount   *int64  `json:"attempt_count,omitempty"`
	CreatedAt      *string `json:"created_at,omitempty"`
	DeliveredAt    *string `json:"delivered_at,omitempty"`
	Event          *string `json:"event,omitempty"`
	EventId        *string `json:"event_id,omitempty"`
	Id             *string `json:"id,omitempty"`
	LastError      *string `json:"last_error,omitempty"`
	LastStatusCode *int64  `json:"last_status_code,omitempty"`
	NextAttemptAt  *string `json:"next_attempt_at,omitempty"`
	Status         *string `json:"status,omitempty"`
	TaskId         *string `json:"task_id,omitempty"`
	UpdatedAt      *string `json:"updated_at,omitempty"`
	Url            *string `json:"url,omitempty"`
	UrlHost        *string `json:"url_host,omitempty"`
}
