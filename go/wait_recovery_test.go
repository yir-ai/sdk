package yir

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWaitJobRecoversBeyondTransportBudget(t *testing.T) {
	statuses, details := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("must only read existing Job")
		}
		switch r.URL.Path {
		case "/v1/jobs/101/status":
			statuses++
			if statuses <= 4 {
				w.WriteHeader(503)
				return
			}
		case "/v1/jobs/101":
			details++
			if details <= 4 {
				w.WriteHeader(502)
				return
			}
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		io.WriteString(w, `{"id":"101","status":"succeeded"}`)
	}))
	defer server.Close()
	client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	job, err := client.WaitJob(ctx, "101", WaitOptions{})
	if err != nil || job.ID != "101" || statuses != 5 || details != 5 {
		t.Fatalf("job=%s err=%v status=%d detail=%d", job.ID, err, statuses, details)
	}
}

func TestWaitReadRecoveryBoundaries(t *testing.T) {
	for _, status := range []int{401, 400, 500} {
		calls := 0
		_, err := retryJobRead(context.Background(), func() (int, error) { calls++; return 0, &APIError{Status: status} })
		if err == nil || calls != 1 {
			t.Fatalf("permanent status %d retried", status)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := retryJobRead(ctx, func() (int, error) { return 0, &APIError{Status: 503, RetryAfter: time.Minute} })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline: %v", err)
	}
}
