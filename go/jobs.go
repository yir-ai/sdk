package yir

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type QuotePrice struct {
	Amount   *string        `json:"amount"`
	Kind     string         `json:"kind"`
	Reason   string         `json:"reason,omitempty"`
	Estimate *QuoteEstimate `json:"estimate,omitempty"`
}

// QuoteEstimate excludes input and other charges and is not an upper bound.
type QuoteEstimate struct {
	Scope               string `json:"scope"`
	OutputTokens        int64  `json:"output_tokens,omitempty"`
	OutputMegapixels    int64  `json:"output_megapixels,omitempty"`
	Quality             string `json:"quality,omitempty"`
	AspectRatio         string `json:"aspect_ratio,omitempty"`
	outputTokensSet     bool
	outputMegapixelsSet bool
	qualitySet          bool
	aspectRatioSet      bool
}

func (e *QuoteEstimate) UnmarshalJSON(data []byte) error {
	type estimateAlias QuoteEstimate
	var value estimateAlias
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*e = QuoteEstimate(value)
	_, e.outputTokensSet = fields["output_tokens"]
	_, e.outputMegapixelsSet = fields["output_megapixels"]
	_, e.qualitySet = fields["quality"]
	_, e.aspectRatioSet = fields["aspect_ratio"]
	return nil
}

type Quote struct {
	BillingMode              string                `json:"billing_mode,omitempty"`
	PriceDifferencePercent   *QuotePriceDifference `json:"price_difference_percent,omitempty"`
	ParameterNotices         []ParameterNotice     `json:"parameter_notices,omitempty"`
	ParameterHandlingMayVary bool                  `json:"parameter_handling_may_vary,omitempty"`
	Supply                   QuoteSupply           `json:"supply"`
	Object                   string                `json:"object"`
	Model                    string                `json:"model"`
	Operation                string                `json:"operation"`
	InputMode                string                `json:"input_mode"`
	Parameters               map[string]any        `json:"parameters"`
	Currency                 string                `json:"currency"`
	Primary                  QuotePrice            `json:"primary"`
	// ExpectedAmount is the first route's admission estimate: the amount Yir
	// checks the balance, Key monthly limit and max_cost against. Unlike an
	// output-only Primary estimate it includes known input charges. Optional.
	ExpectedAmount *string    `json:"expected_amount,omitempty"`
	Official       QuotePrice `json:"official"`
	ExpiresAt      int64      `json:"expires_at"`
	raw            string
}

// QuotePriceDifference is comparison metadata, never a charge or authorization.
type QuotePriceDifference struct {
	Min                   float64 `json:"min"`
	Max                   float64 `json:"max"`
	ReferenceAmountMicros *int64  `json:"reference_amount_micros,omitempty"`
}

type QuoteSupply struct {
	Available bool     `json:"available"`
	Issues    []string `json:"issues"`
}

type Job struct {
	ParameterNotices []ParameterNotice `json:"parameter_notices,omitempty"`
	ID               string            `json:"id"`
	Object           string            `json:"object"`
	FinalProvider    string            `json:"final_provider,omitempty"`
	Model            string            `json:"model"`
	// Parameters echoes the normalized parameters the Job executes with, in the
	// Quote.Parameters shape; nil only when the Gateway no longer holds them.
	Parameters   map[string]any   `json:"parameters,omitempty"`
	Status       string           `json:"status"`
	URLs         *JobURLs         `json:"urls,omitempty"`
	Usage        *JobUsage        `json:"usage,omitempty"`
	Error        *APIError        `json:"error"`
	CreatedAt    int64            `json:"created_at"`
	CompletedAt  *int64           `json:"completed_at,omitempty"`
	Cancellation *JobCancellation `json:"cancellation,omitempty"`
	Result       *JobResult       `json:"result,omitempty"`
	Billing      *JobBilling      `json:"billing,omitempty"`
	raw          string
}

type JobURLs struct {
	Get    string `json:"get"`
	Cancel string `json:"cancel"`
}

type JobUsage struct {
	Outputs int64 `json:"outputs"`
}

type JobCancellation struct {
	Status      string `json:"status"`
	Effect      string `json:"effect,omitempty"`
	RequestedAt int64  `json:"requested_at"`
}

type JobResult struct {
	Availability  string               `json:"availability"`
	Files         []ResultFile         `json:"files,omitempty"`
	Warnings      []string             `json:"warnings,omitempty"`
	ContentSafety *ResultContentSafety `json:"content_safety,omitempty"`
}

const ResultWarningAdditionalResultsUnavailable = "additional_results_unavailable"

// ResultContentSafety reports whether the result passed an NSFW check and who ran it.
// Status is "passed" (CheckedBy "provider" or "yir") or "unchecked"; it is absent on historical results.
type ResultContentSafety struct {
	Status    string `json:"status"`
	CheckedBy string `json:"checked_by,omitempty"`
}

type ResultFile struct {
	URL       string `json:"url"`
	MediaType string `json:"media_type"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	ExpiresAt int64  `json:"expires_at"`
	// Fidelity reports where the file came from and whether its specification is genuine,
	// judged at delivery from its C2PA content signature and Yir's channel audits; nil on
	// results delivered before the field existed.
	Fidelity *ResultFileFidelity `json:"fidelity,omitempty"`
}

// ResultFileFidelity grades a delivered file: "original" (untouched vendor API output),
// "app" (untouched output of the vendor's consumer app, such as ChatGPT), "equivalent"
// (no valid vendor signature, but native output with no post-processing), "altered"
// (changed after generation, for example upscaled) or "unverified" (no evidence either way).
// Reason is a stable code such as "vendor_signed" or "hash_mismatch".
type ResultFileFidelity struct {
	Grade  string `json:"grade"`
	Reason string `json:"reason"`
}

type JobBilling struct {
	BillingMode        string              `json:"billing_mode,omitempty"`
	Currency           string              `json:"currency"`
	ComputeCharges     []ComputeCharge     `json:"compute_charges"`
	GatewayFee         GatewayFee          `json:"gateway_fee"`
	TotalChargedByYir  string              `json:"total_charged_by_yir"`
	MaxCost            string              `json:"max_cost,omitempty"`
	OfficialComparison *OfficialComparison `json:"official_comparison,omitempty"`
}

// ComputeCharge is a read-only billing fact for managed supply billed by Yir.
type ComputeCharge struct {
	SupplyType  string       `json:"supply_type"`
	BilledBy    string       `json:"billed_by"`
	Amount      string       `json:"amount"`
	AmountBasis string       `json:"amount_basis"`
	Status      string       `json:"status"`
	Usage       []UsageEntry `json:"usage,omitempty"`
}

type UsageEntry struct {
	Metric   string `json:"metric"`
	Quantity string `json:"quantity"`
	Unit     string `json:"unit"`
}

type GatewayFee struct {
	Amount string `json:"amount"`
	Status string `json:"status"`
}

type OfficialComparison struct {
	BaselineAmount string `json:"baseline_amount"`
	SavingsAmount  string `json:"savings_amount"`
	SourceURL      string `json:"source_url,omitempty"`
}

func (job Job) IsTerminal() bool {
	return job.Status == "succeeded" || job.Status == "failed" || job.Status == "cancelled"
}

type JobStatusResponse struct {
	ID           string           `json:"id"`
	Status       string           `json:"status"`
	Error        *APIError        `json:"error"`
	Cancellation *JobCancellation `json:"cancellation,omitempty"`
	raw          string
}

func (s JobStatusResponse) IsTerminal() bool {
	return s.Status == "succeeded" || s.Status == "failed" || s.Status == "cancelled"
}

// ErrJobStateInconsistent indicates that the terminal status summary and the
// one full Job read disagree. The detail response is authoritative for the
// returned Job, so WaitJob returns no partial Job in this case.
var ErrJobStateInconsistent = errors.New("job_state_inconsistent")

// validJobStatus accepts statuses newer than this SDK. Only succeeded, failed
// and cancelled are terminal; any other status is in progress, so WaitJob keeps
// polling and a newer status never hides an accepted Job ID.
func validJobStatus(status string) bool {
	return strings.TrimSpace(status) != ""
}

type JobError struct{ Job Job }

func (e *JobError) Error() string {
	return fmt.Sprintf("yir job %s ended as %s", e.Job.ID, e.Job.Status)
}

type WaitOptions struct {
	// PollInterval fixes the delay between status queries. Zero uses PollDelay.
	PollInterval time.Duration
	// StatusWait is how long the Gateway may hold each status query until the
	// status changes. Zero uses DefaultStatusWait; negative disables long polling.
	StatusWait time.Duration
	OnPoll     func(JobStatusResponse)
}

// DefaultStatusWait is the default long-poll hold of WaitJob, below the
// default 30-second HTTP client timeout.
const DefaultStatusWait = 20 * time.Second

// maxStatusWait is the Gateway's cap for the wait query parameter.
const maxStatusWait = 30 * time.Second

// pollDelay lets tests observe WaitJob's default schedule without real sleeps.
var pollDelay = PollDelay

// PollDelay is the recommended delay after a status query for one Job. poll is
// the zero-based index of the query that just completed (0 after the first):
// 5s for the first 30 seconds, 10s until about 90 seconds, then 20s. Durable
// workflows can reuse it with their own timers.
func PollDelay(poll int) time.Duration {
	switch {
	case poll < 6:
		return 5 * time.Second
	case poll < 12:
		return 10 * time.Second
	default:
		return 20 * time.Second
	}
}

// WaitJob only polls. Cancelling its context never sends a Job cancellation or
// implies failure/refund; callers can resume polling with the same Job ID.
func (c *Client) WaitJob(ctx context.Context, id string, options WaitOptions) (Job, error) {
	if options.PollInterval < 0 {
		return Job{}, errors.New("poll_interval_invalid")
	}
	var previous string
	limited := 0
	for poll := 0; ; poll++ {
		wait := c.statusWait(ctx, options.StatusWait)
		started := time.Now()
		status, err := c.GetJobStatusWithWait(ctx, id, wait)
		if err != nil {
			if pause := rateLimitPause(err, limited); pause >= 0 {
				limited++
				poll--
				if err := rateLimitSleep(ctx, pause); err != nil {
					return Job{}, err
				}
				continue
			}
			return Job{}, err
		}
		limited = 0
		if options.OnPoll != nil {
			options.OnPoll(status)
		}
		if status.IsTerminal() {
			job, err := c.GetJob(ctx, id)
			if err != nil {
				return Job{}, err
			}
			if job.Status != status.Status || !job.IsTerminal() {
				return Job{}, fmt.Errorf("%w: status summary reported %q but job detail returned %q", ErrJobStateInconsistent, status.Status, job.Status)
			}
			if job.Status == "succeeded" {
				return job, nil
			}
			return job, &JobError{Job: job}
		}
		changed := poll > 0 && status.Status != previous
		previous = status.Status
		// A held query that returned on a change or after holding needs no extra
		// delay. A quick unchanged answer means the Gateway did not hold it.
		if wait > 0 && (changed || time.Since(started) >= wait/2) {
			continue
		}
		interval := options.PollInterval
		if interval == 0 {
			interval = pollDelay(poll)
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return Job{}, ctx.Err()
		case <-timer.C:
		}
	}
}

// maxRateLimitRetries bounds consecutive 429 responses WaitJob waits out.
const maxRateLimitRetries = 5

// rateLimitPause returns how long WaitJob waits after a 429 before polling
// again: Retry-After, defaulting to one second and capped at one minute. It
// returns -1 for other errors or once retries are exhausted.
func rateLimitPause(err error, retries int) time.Duration {
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusTooManyRequests || retries >= maxRateLimitRetries {
		return -1
	}
	if apiErr.RetryAfter <= 0 {
		return time.Second
	}
	return min(apiErr.RetryAfter, time.Minute)
}

// rateLimitSleep lets tests skip WaitJob's 429 pauses.
var rateLimitSleep = sleepContext

func sleepContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// statusWait keeps a held status query inside the HTTP client timeout and the
// caller's deadline, in whole seconds.
func (c *Client) statusWait(ctx context.Context, requested time.Duration) time.Duration {
	if requested < 0 {
		return 0
	}
	wait := requested
	if wait == 0 {
		wait = DefaultStatusWait
	}
	wait = min(wait, maxStatusWait)
	if c != nil && c.httpClient != nil && c.httpClient.Timeout > 0 {
		wait = min(wait, c.httpClient.Timeout-10*time.Second)
	}
	if deadline, ok := ctx.Deadline(); ok {
		wait = min(wait, time.Until(deadline)-time.Second)
	}
	return max(wait.Truncate(time.Second), 0)
}
