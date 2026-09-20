package yir

import (
	"context"
	"errors"
	"fmt"
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
	Scope        string `json:"scope"`
	OutputTokens int64  `json:"output_tokens"`
}

type Quote struct {
	ParameterNotices         []ParameterNotice `json:"parameter_notices,omitempty"`
	ParameterHandlingMayVary bool              `json:"parameter_handling_may_vary,omitempty"`
	Supply                   QuoteSupply       `json:"supply"`
	Object                   string            `json:"object"`
	Model                    string            `json:"model"`
	Operation                string            `json:"operation"`
	InputMode                string            `json:"input_mode"`
	Parameters               map[string]any    `json:"parameters"`
	Currency                 string            `json:"currency"`
	Primary                  QuotePrice        `json:"primary"`
	Max                      QuotePrice        `json:"max"`
	Official                 QuotePrice        `json:"official"`
	SingleAttemptUpperBound  *string           `json:"single_attempt_upper_bound"`
	HasVerifiableUpperBound  bool              `json:"has_verifiable_upper_bound"`
	ExpiresAt                int64             `json:"expires_at"`
}

type QuoteSupply struct {
	Available bool     `json:"available"`
	Issues    []string `json:"issues"`
}

type Job struct {
	ParameterNotices []ParameterNotice `json:"parameter_notices,omitempty"`
	ID               string            `json:"id"`
	Object           string            `json:"object"`
	Model            string            `json:"model"`
	Status           string            `json:"status"`
	Error            *APIError         `json:"error"`
	CreatedAt        int64             `json:"created_at"`
	CompletedAt      *int64            `json:"completed_at,omitempty"`
	Cancellation     *JobCancellation  `json:"cancellation,omitempty"`
	Result           *JobResult        `json:"result,omitempty"`
	Billing          *JobBilling       `json:"billing,omitempty"`
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
	Currency          string `json:"currency"`
	TotalChargedByYir string `json:"total_charged_by_yir"`
	MaxCost           string `json:"max_cost,omitempty"`
}

func (job Job) IsTerminal() bool {
	return job.Status == "succeeded" || job.Status == "failed" || job.Status == "cancelled"
}

type JobStatusResponse struct {
	ID           string           `json:"id"`
	Status       string           `json:"status"`
	Error        *APIError        `json:"error"`
	Cancellation *JobCancellation `json:"cancellation,omitempty"`
}

func (s JobStatusResponse) IsTerminal() bool {
	return s.Status == "succeeded" || s.Status == "failed" || s.Status == "cancelled"
}

// ErrJobStateInconsistent indicates that the terminal status summary and the
// one full Job read disagree. The detail response is authoritative for the
// returned Job, so WaitJob returns no partial Job in this case.
var ErrJobStateInconsistent = errors.New("job_state_inconsistent")

func validJobStatus(status string) bool {
	return status == "queued" || status == "running" || status == "delivering" || status == "succeeded" || status == "failed" || status == "cancelled"
}

type JobError struct{ Job Job }

func (e *JobError) Error() string {
	return fmt.Sprintf("yir job %s ended as %s", e.Job.ID, e.Job.Status)
}

type WaitOptions struct {
	PollInterval time.Duration
	OnPoll       func(JobStatusResponse)
}

// WaitJob only polls. Cancelling its context never sends a Job cancellation or
// implies failure/refund; callers can resume polling with the same Job ID.
func (c *Client) WaitJob(ctx context.Context, id string, options WaitOptions) (Job, error) {
	interval := options.PollInterval
	if interval == 0 {
		interval = 2 * time.Second
	}
	if interval < 0 {
		return Job{}, errors.New("poll_interval_invalid")
	}
	for {
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
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return Job{}, ctx.Err()
		case <-timer.C:
		}
	}
}
