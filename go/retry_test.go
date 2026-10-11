package yir

import (
	"context"
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
