package yir

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	Max                      QuotePrice            `json:"max"`
	Official                 QuotePrice            `json:"official"`
	SingleAttemptUpperBound  *string               `json:"single_attempt_upper_bound"`
	HasVerifiableUpperBound  bool                  `json:"has_verifiable_upper_bound"`
	ExpiresAt                int64                 `json:"expires_at"`
	raw                      string
}

// QuotePriceDifference is comparison metadata, never a charge or authorization.
type QuotePriceDifference struct {
	Min                   float64 `json:"min"`
	Max                   float64 `json:"max"`
	ReferenceAmountMicros *int64  `json:"reference_amount_micros,omitempty"`
}

type QuoteSupply struct {
	Available       bool     `json:"available"`
	RequiresMaxCost bool     `json:"requires_max_cost"`
	Issues          []string `json:"issues"`
}

type Job struct {
	ParameterNotices []ParameterNotice `json:"parameter_notices,omitempty"`
	ID               string            `json:"id"`
	Object           string            `json:"object"`
	FinalProvider    string            `json:"final_provider,omitempty"`
	Model            string            `json:"model"`
	Status           string            `json:"status"`
	URLs             *JobURLs          `json:"urls,omitempty"`
	Usage            *JobUsage         `json:"usage,omitempty"`
	Error            *APIError         `json:"error"`
	CreatedAt        int64             `json:"created_at"`
	CompletedAt      *int64            `json:"completed_at,omitempty"`
	Cancellation     *JobCancellation  `json:"cancellation,omitempty"`
	Result           *JobResult        `json:"result,omitempty"`
	Billing          *JobBilling       `json:"billing,omitempty"`
	raw              string
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
	Availability string       `json:"availability"`
	Files        []ResultFile `json:"files,omitempty"`
	Warnings     []string     `json:"warnings,omitempty"`
}

const ResultWarningAdditionalResultsUnavailable = "additional_results_unavailable"

type ResultFile struct {
	URL       string `json:"url"`
	MediaType string `json:"media_type"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	ExpiresAt int64  `json:"expires_at"`
}

type JobBilling struct {
	BillingMode        string              `json:"billing_mode,omitempty"`
	Currency           string              `json:"currency"`
	ComputeCharges     []ComputeCharge     `json:"compute_charges"`
	GatewayFee         GatewayFee          `json:"gateway_fee"`
	TotalChargedByYir  string              `json:"total_charged_by_yir"`
	MaxCost            string              `json:"max_cost,omitempty"`
	Savings            *Savings            `json:"savings,omitempty"`
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

type Savings struct {
	Amount           string `json:"amount"`
	Kind             string `json:"kind"`
	BaselineAmount   string `json:"baseline_amount"`
	ActualUserCharge string `json:"actual_user_charge"`
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
	OnPoll       func(JobStatusResponse)
}

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
	for poll := 0; ; poll++ {
		status, err := c.GetJobStatus(ctx, id)
		if err != nil {
			return Job{}, err
		}
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
