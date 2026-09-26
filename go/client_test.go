package yir

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func imageRequest() GenerationRequest {
	return GenerationRequest{Model: "openai/gpt-image-2", Input: GenerationInput{Type: "text", Prompt: "observatory"}}
}

func TestClientQuoteAndSubmitShareDemand(t *testing.T) {
	var calls []map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing bearer")
		}
		if r.Method != http.MethodPost {
			t.Error("wrong method")
		}
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		calls = append(calls, body)
		switch r.URL.Path {
		case "/v1/images/quotes":
			if r.Header.Get("Idempotency-Key") != "" {
				t.Error("quote has submit key")
			}
			io.WriteString(w, `{"object":"quote","model":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","parameters":{},"currency":"USD","expires_at":3000000000,"has_verifiable_upper_bound":true,"single_attempt_upper_bound":"0.05","primary":{"kind":"fixed","amount":"0.02"},"max":{"kind":"fixed","amount":"0.05"},"official":{"kind":"unavailable","amount":null,"reason":"official_price_unavailable"}}`)
		case "/v1/images/generations":
			if r.Header.Get("Idempotency-Key") != "stable-key" {
				t.Error("key not preserved")
			}
			w.WriteHeader(http.StatusAccepted)
			io.WriteString(w, `{"object":"job","id":"1","status":"queued"}`)
		default:
			t.Error("unexpected path")
		}
	}))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	request := imageRequest()
	quote, err := client.QuoteImage(context.Background(), request)
	if err != nil || quote.Primary.Amount == nil || *quote.Primary.Amount != "0.02" || quote.Official.Amount != nil {
		t.Fatalf("quote: %+v %v", quote, err)
	}
	maxCost := "0.05"
	job, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: request, MaxCost: &maxCost}, "stable-key")
	if err != nil || job.ID != "1" {
		t.Fatalf("submit: %+v %v", job, err)
	}
	if len(calls) != 2 {
		t.Fatal("unexpected requests")
	}
	if string(calls[1]["max_cost"]) != `"0.05"` {
		t.Fatal("max cost lost")
	}
	delete(calls[1], "max_cost")
	a, _ := json.Marshal(calls[0])
	b, _ := json.Marshal(calls[1])
	if string(a) != string(b) || string(calls[0]["parameters"]) != "{}" {
		t.Fatal("demand drift")
	}
	if request.Parameters != nil {
		t.Fatal("mutated caller")
	}
}

func TestClientRejectsInvalidRequestsBeforeNetwork(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL, ModelContracts: testModelContracts()})
	if err != nil {
		t.Fatal(err)
	}
	request := imageRequest()
	request.Parameters = map[string]any{"n": "1"}
	if _, err := client.QuoteImage(context.Background(), request); err == nil {
		t.Fatal("invalid quote accepted")
	}
	if _, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: request}, "key"); err == nil {
		t.Fatal("invalid submit accepted")
	}
	for _, cost := range []string{"-1", "0.0000001", "9223372036854.775808", "NaN"} {
		if _, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: imageRequest(), MaxCost: &cost}, "key"); err == nil {
			t.Fatal("invalid budget accepted")
		}
	}
	if _, err := client.GetJob(context.Background(), "../secrets"); err == nil {
		t.Fatal("invalid id accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("validation performed network request")
	}
}

func TestClientSubmitAcceptsDecimalBudgetWithLeadingZeros(t *testing.T) {
	for _, cost := range []string{"008", "009", "012", "000", "000.000001", "9223372036854.775807"} {
		t.Run(cost, func(t *testing.T) {
			var calls int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var body SubmitRequest
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if body.MaxCost == nil || *body.MaxCost != cost {
					t.Error("caller budget changed")
				}
				w.WriteHeader(http.StatusAccepted)
				io.WriteString(w, `{"object":"job","id":"1","status":"queued"}`)
			}))
			defer server.Close()
			client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: imageRequest(), MaxCost: &cost}, "same-key")
			if err != nil || calls != 1 {
				t.Fatalf("decimal budget rejected or submitted more than once: calls=%d error=%v", calls, err)
			}
		})
	}
}

func TestClientDoesNotFollowRedirectOrRetrySubmit(t *testing.T) {
	var redirected, submitted atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		submitted.Add(1)
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	_, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: imageRequest()}, "same-key")
	var apiError *APIError
	if !errors.As(err, &apiError) || apiError.Status != 307 {
		t.Fatalf("error: %v", err)
	}
	if submitted.Load() != 1 || redirected.Load() != 0 {
		t.Fatal("unexpected retry or credential forwarding")
	}
}

func TestClientMapsStructuredErrorsWithoutEchoingRawBodies(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(402)
		io.WriteString(w, `{"error":{"code":"YIR_INSUFFICIENT_BALANCE","message":"private-body","retryable":false,"action":"add_funds"}}`)
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	_, err := client.GetJob(context.Background(), "1")
	var apiError *APIError
	if !errors.As(err, &apiError) || apiError.Action != "add_funds" || apiError.Code != "YIR_INSUFFICIENT_BALANCE" {
		t.Fatalf("error: %v", err)
	}
	if strings.Contains(err.Error(), "private-body") {
		t.Fatal("error string echoed body")
	}
}

func TestClientGetJobStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/v1/jobs/1/status" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		io.WriteString(w, `{"id":"1","status":"running","error":null}`)
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	status, err := client.GetJobStatus(context.Background(), "1")
	if err != nil || status.ID != "1" || status.Status != "running" {
		t.Fatalf("status: %+v %v", status, err)
	}
}

func TestWaitJobPreservesStopRequestedUntilSuccess(t *testing.T) {
	var statusCalls, detailCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("wait mutated job")
		}
		switch r.URL.Path {
		case "/v1/jobs/1/status":
			statusCalls++
			if statusCalls == 1 {
				io.WriteString(w, `{"id":"1","status":"running","cancellation":{"status":"stop_requested","effect":"stop_future_attempts"}}`)
				return
			}
			io.WriteString(w, `{"id":"1","status":"succeeded"}`)
		case "/v1/jobs/1":
			detailCalls++
			io.WriteString(w, `{"id":"1","status":"succeeded","billing":{"currency":"USD","total_charged_by_yir":"0.02"},"result":{"availability":"available","files":[{"url":"https://example.com/result.png"}]}}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	job, err := client.WaitJob(ctx, "1", WaitOptions{PollInterval: time.Millisecond})
	if err != nil || job.Status != "succeeded" || job.Billing.TotalChargedByYir != "0.02" || statusCalls != 2 || detailCalls != 1 {
		t.Fatalf("job: %+v %v statusCalls=%d detailCalls=%d", job, err, statusCalls, detailCalls)
	}
}

func TestWaitCancellationReturnsZeroJobAndSavesLastStatusViaOnPollWithoutCancellingRemote(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" || r.URL.Path != "/v1/jobs/1/status" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		io.WriteString(w, `{"id":"1","status":"running"}`)
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var lastStatus JobStatusResponse
	job, err := client.WaitJob(ctx, "1", WaitOptions{OnPoll: func(s JobStatusResponse) {
		lastStatus = s
		cancel()
	}})
	if !errors.Is(err, context.Canceled) || job.Status != "" || lastStatus.Status != "running" || calls.Load() != 1 {
		t.Fatalf("job: %+v %v lastStatus: %+v", job, err, lastStatus)
	}
}

func TestSubmitUnknownOutcomeIsNotRetried(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		io.Copy(io.Discard, r.Body)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		conn.Close()
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	_, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: imageRequest()}, "original-key")
	if err == nil || calls.Load() != 1 {
		t.Fatalf("calls=%d err=%v", calls.Load(), err)
	}
}

func TestWaitRejectsMismatchedJobAndInvalidStatus(t *testing.T) {
	for _, body := range []string{`{"id":"2","status":"succeeded"}`, `{"id":"1","status":"unknown"}`, `null`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, body) }))
			defer server.Close()
			client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
			_, err := client.WaitJob(context.Background(), "1", WaitOptions{})
			if err == nil || err.Error() != "response_invalid" {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestWaitReturnsFailedJobWithPublicError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/jobs/1/status":
			io.WriteString(w, `{"id":"1","status":"failed","error":{"code":"YIR_OUTCOME_TIMEOUT"}}`)
		case "/v1/jobs/1":
			io.WriteString(w, `{"id":"1","status":"failed","error":{"code":"YIR_OUTCOME_TIMEOUT"},"billing":{"currency":"USD","total_charged_by_yir":"0.00"}}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	job, err := client.WaitJob(context.Background(), "1", WaitOptions{})
	var jobError *JobError
	if !errors.As(err, &jobError) || job.Error.Code != "YIR_OUTCOME_TIMEOUT" || job.Billing.TotalChargedByYir != "0.00" {
		t.Fatalf("job=%+v err=%v", job, err)
	}
}

func TestWaitRejectsTerminalStatusDetailMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/jobs/1/status":
			io.WriteString(w, `{"id":"1","status":"succeeded"}`)
		case "/v1/jobs/1":
			io.WriteString(w, `{"id":"1","status":"running"}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	_, err := client.WaitJob(context.Background(), "1", WaitOptions{})
	if !errors.Is(err, ErrJobStateInconsistent) {
		t.Fatalf("error=%v", err)
	}
}
