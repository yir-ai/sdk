package yir

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestSafeRetryLostSubmitResponse(t *testing.T) {
	var mu sync.Mutex
	var requests int
	var key, body string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		requests++
		raw, _ := io.ReadAll(r.Body)
		if requests == 1 {
			key, body = r.Header.Get("Idempotency-Key"), string(raw)
			conn, _, _ := w.(http.Hijacker).Hijack()
			_ = conn.Close()
			return
		}
		if key != r.Header.Get("Idempotency-Key") || body != string(raw) {
			t.Error("request identity changed")
		}
		_, _ = w.Write([]byte(`{"id":"job-1","status":"queued"}`))
	}))
	defer server.Close()
	c, err := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	var response Job
	if err := c.do(context.Background(), "POST", "/v1/videos/generations", "persisted-key", map[string]string{"model": "fixture"}, &response); err != nil {
		t.Fatal(err)
	}
	if response.ID != "job-1" || requests != 2 {
		t.Fatalf("response=%v requests=%d", response, requests)
	}
}

func TestSafeRetryDoesNotReplayUnsafeWrites(t *testing.T) {
	for _, path := range []string{"/v1/jobs/job-1/cancel", "/v1/videos/generations"} {
		t.Run(path, func(t *testing.T) {
			calls := 0
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++; w.WriteHeader(502) }))
			defer s.Close()
			c, _ := NewClient("fixture", ClientOptions{BaseURL: s.URL})
			if err := c.do(context.Background(), "POST", path, "", nil, &Job{}); err == nil {
				t.Fatal("wanted error")
			}
			if calls != 1 {
				t.Fatalf("calls=%d", calls)
			}
		})
	}
}

func TestSafeRetryCancellationStopsBackoff(t *testing.T) {
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++; w.WriteHeader(503) }))
	defer s.Close()
	c, _ := NewClient("fixture", ClientOptions{BaseURL: s.URL})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := c.do(ctx, "GET", "/v1/jobs/job-1", "", nil, &Job{}); err == nil {
		t.Fatal("wanted cancellation")
	}
	if calls != 1 {
		t.Fatalf("calls=%d", calls)
	}
}

// Submit attempts after an unknown outcome may be rejected by admission checks
// that run before idempotent replay; the first attempt may still have created
// a billed Job, so the error must not read as a plain rejection.
func TestSubmitRetryAfterUnknownOutcomeIsUncertain(t *testing.T) {
	dropConnection := func(w http.ResponseWriter) {
		conn, _, _ := w.(http.Hijacker).Hijack()
		_ = conn.Close()
	}
	cutAcceptedBody := func(w http.ResponseWriter) {
		conn, _, _ := w.(http.Hijacker).Hijack()
		_, _ = io.WriteString(conn, "HTTP/1.1 202 Accepted\r\nContent-Type: application/json\r\nContent-Length: 64\r\n\r\n{\"id\":\"job-1\",")
		_ = conn.Close()
	}
	reject := func(status int, code string) func(http.ResponseWriter) {
		return func(w http.ResponseWriter) {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"error":{"code":"`+code+`","message":"fixture"}}`)
		}
	}
	unavailable := reject(503, ErrCodeTemporarilyUnavailable)
	accept := func(w http.ResponseWriter) {
		w.WriteHeader(202)
		_, _ = io.WriteString(w, `{"id":"job-1","status":"queued"}`)
	}
	for _, tc := range []struct {
		name      string
		responses []func(http.ResponseWriter)
		status    int
		code      string
	}{
		{"lost response then rate limited", []func(http.ResponseWriter){dropConnection, reject(429, ErrCodeRateLimited)}, 429, ErrCodeRateLimited},
		{"accepted body cut off then rate limited", []func(http.ResponseWriter){cutAcceptedBody, reject(429, ErrCodeRateLimited)}, 429, ErrCodeRateLimited},
		{"unavailable then insufficient balance", []func(http.ResponseWriter){unavailable, reject(402, ErrCodeInsufficientBalance)}, 402, ErrCodeInsufficientBalance},
		{"unavailable on every attempt", []func(http.ResponseWriter){unavailable, unavailable, unavailable, unavailable}, 503, ErrCodeTemporarilyUnavailable},
		{"lost response then accepted", []func(http.ResponseWriter){dropConnection, accept}, 0, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var mu sync.Mutex
			var keys []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				keys = append(keys, r.Header.Get("Idempotency-Key"))
				respond := tc.responses[min(len(keys), len(tc.responses))-1]
				mu.Unlock()
				_, _ = io.ReadAll(r.Body)
				respond(w)
			}))
			defer server.Close()
			c, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL})
			job, err := c.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: imageRequest()}, "persisted-key")
			mu.Lock()
			defer mu.Unlock()
			if len(keys) != len(tc.responses) {
				t.Fatalf("requests=%d want %d", len(keys), len(tc.responses))
			}
			for _, key := range keys {
				if key != "persisted-key" {
					t.Fatalf("key changed: %q", key)
				}
			}
			if tc.status == 0 {
				if err != nil || job.ID != "job-1" {
					t.Fatalf("job=%v err=%v", job, err)
				}
				return
			}
			var submission *SubmissionError
			var uncertain *SubmissionUncertainError
			var api *APIError
			if !errors.As(err, &submission) || submission.IdempotencyKey != "persisted-key" {
				t.Fatalf("missing submission error: %v", err)
			}
			if !errors.As(err, &uncertain) || uncertain.IdempotencyKey != "persisted-key" {
				t.Fatalf("missing uncertain error: %v", err)
			}
			if !errors.As(uncertain.Err, &api) || api.Status != tc.status || api.Code != tc.code {
				t.Fatalf("lost last API error: %v", err)
			}
		})
	}
}

func TestReadRetryFailureStaysPlainAPIError(t *testing.T) {
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++; w.WriteHeader(503) }))
	defer s.Close()
	c, _ := NewClient("fixture", ClientOptions{BaseURL: s.URL})
	_, err := c.GetJob(context.Background(), "job-1")
	var uncertain *SubmissionUncertainError
	var api *APIError
	if errors.As(err, &uncertain) || !errors.As(err, &api) || api.Status != 503 || calls != 4 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}
