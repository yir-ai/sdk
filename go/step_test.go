package yir

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSubmissionNotAccepted(t *testing.T) {
	api := func(status int, code string) error {
		return &SubmissionError{IdempotencyKey: "key", Err: &APIError{Status: status, Code: code}}
	}
	for _, tc := range []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"local validation", &ParameterError{"max_cost", "invalid_amount"}, true},
		{"insufficient balance", api(402, ErrCodeInsufficientBalance), true},
		{"invalid request", api(400, ErrCodeInvalidRequest), true},
		{"no route", api(422, ErrCodeNoExecutableRoute), true},
		{"rate limited", api(429, ErrCodeRateLimited), true},
		{"file not ready", api(409, ErrCodeFileNotReady), true},
		{"idempotency conflict", api(409, ErrCodeIdempotencyConflict), false},
		{"job not found after create", api(404, ErrCodeJobNotFound), false},
		{"request timeout", api(408, ErrCodeTemporarilyUnavailable), false},
		{"unavailable", api(503, ErrCodeTemporarilyUnavailable), false},
		{"edge response without a Yir code", api(429, "http_error"), false},
		{"unreadable accepted response", &SubmissionError{IdempotencyKey: "key", Err: errors.New("response_invalid")}, false},
		{"uncertain", &SubmissionError{IdempotencyKey: "key", Err: &SubmissionUncertainError{IdempotencyKey: "key", Err: &APIError{Status: 429, Code: ErrCodeRateLimited}}}, false},
	} {
		if got := SubmissionNotAccepted(tc.err); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestSubmitRejectionIsNotAccepted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(402)
		_, _ = io.WriteString(w, `{"error":{"code":"YIR_INSUFFICIENT_BALANCE","message":"fixture","retryable":false},"request_id":"r1"}`)
	}))
	defer server.Close()
	c, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	_, err := c.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: imageRequest()}, "persisted-key")
	if !SubmissionNotAccepted(err) {
		t.Fatalf("want not accepted: %v", err)
	}
}

func TestCancelJobReturnsFinishedJob(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/jobs/101/cancel":
			w.WriteHeader(409)
			_, _ = io.WriteString(w, `{"error":{"code":"YIR_JOB_NOT_CANCELLABLE","message":"fixture","retryable":false},"request_id":"r1"}`)
		case "GET /v1/jobs/101":
			_, _ = io.WriteString(w, `{"id":"101","status":"succeeded","billing":{"currency":"USD","total_charged_by_yir":"0.02"}}`)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()
	c, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	job, err := c.CancelJob(context.Background(), "101")
	if err != nil || job.Status != "succeeded" || job.Billing == nil {
		t.Fatalf("job=%+v err=%v", job, err)
	}
}

func TestPollJob(t *testing.T) {
	for _, tc := range []struct {
		name, status, detail, want string
		details                    int
		inconsistent               bool
	}{
		{"in progress reads no detail", `{"id":"101","status":"running","error":null,"cancellation":{"status":"stop_requested"}}`, "", "running", 0, false},
		{"terminal reads the full job", `{"id":"101","status":"failed","error":null}`, `{"id":"101","status":"failed","billing":{"currency":"USD","total_charged_by_yir":"0.02"}}`, "failed", 1, false},
		{"summary and detail disagree", `{"id":"101","status":"succeeded","error":null}`, `{"id":"101","status":"running"}`, "", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			details := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/jobs/101/status" {
					_, _ = io.WriteString(w, tc.status)
					return
				}
				details++
				_, _ = io.WriteString(w, tc.detail)
			}))
			defer server.Close()
			c, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL})
			job, err := c.PollJob(context.Background(), "101", 0)
			if details != tc.details {
				t.Fatalf("detail reads=%d want %d", details, tc.details)
			}
			if tc.inconsistent {
				if !errors.Is(err, ErrJobStateInconsistent) || job.ID != "" {
					t.Fatalf("job=%+v err=%v", job, err)
				}
				return
			}
			if err != nil || job.ID != "101" || job.Status != tc.want || job.IsTerminal() != (tc.details == 1) {
				t.Fatalf("job=%+v err=%v", job, err)
			}
			if tc.details == 0 && (job.Cancellation == nil || job.Billing != nil) {
				t.Fatalf("in-progress job should carry the status summary only: %+v", job)
			}
			if tc.details == 1 && job.Billing == nil {
				t.Fatalf("terminal job lost its detail: %+v", job)
			}
		})
	}
}

func TestUSDMicros(t *testing.T) {
	for amount, want := range map[string]int64{"0": 0, "0.0325": 32500, "12": 12000000, "1.000001": 1000001} {
		if got, err := USDMicros(amount); err != nil || got != want {
			t.Errorf("%s: got %d err=%v", amount, got, err)
		}
	}
	for _, amount := range []string{"", "-1", "1.", ".5", "1e3", "0.0000001", "9999999999999.999999"} {
		if _, err := USDMicros(amount); err == nil {
			t.Errorf("%q: want error", amount)
		}
	}
	if micros, err := (JobBilling{TotalChargedByYir: "0.02"}).TotalChargedMicros(); err != nil || micros != 20000 {
		t.Fatalf("micros=%d err=%v", micros, err)
	}
}
