package yir

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestWaitJobStatusDetailFlowAndPathCount(t *testing.T) {
	var statusCalls, detailCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/jobs/101/status":
			count := statusCalls.Add(1)
			if count < 3 {
				io.WriteString(w, `{"id":"101","status":"running","error":null}`)
			} else {
				io.WriteString(w, `{"id":"101","status":"succeeded","error":null}`)
			}
		case "/v1/jobs/101":
			detailCalls.Add(1)
			io.WriteString(w, `{"id":"101","status":"succeeded","model":"openai/gpt-image-2","billing":{"currency":"USD","total_charged_by_yir":"0.02"}}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}

	var polled []string
	job, err := client.WaitJob(context.Background(), "101", WaitOptions{
		PollInterval: 5 * time.Millisecond,
		OnPoll: func(s JobStatusResponse) {
			polled = append(polled, s.Status)
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if job.ID != "101" || job.Status != "succeeded" {
		t.Fatalf("unexpected job result: %+v", job)
	}
	if statusCalls.Load() != 3 {
		t.Fatalf("expected 3 status calls, got %d", statusCalls.Load())
	}
	if detailCalls.Load() != 1 {
		t.Fatalf("expected exactly 1 detail call, got %d", detailCalls.Load())
	}
	if len(polled) != 3 || polled[0] != "running" || polled[1] != "running" || polled[2] != "succeeded" {
		t.Fatalf("unexpected poll sequence: %v", polled)
	}
}

func TestWaitJobDetailFailureReturnsZeroJob(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/jobs/102/status":
			io.WriteString(w, `{"id":"102","status":"succeeded"}`)
		case "/v1/jobs/102":
			w.WriteHeader(http.StatusInternalServerError)
			io.WriteString(w, `{"error":{"code":"internal_error","message":"backend failed"}}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	job, err := client.WaitJob(context.Background(), "102", WaitOptions{PollInterval: time.Millisecond})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if job.ID != "" || job.Status != "" {
		t.Fatalf("expected zero Job on detail error, got %+v", job)
	}
}

func TestWaitJobTerminalInconsistencyReturnsZeroJob(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/jobs/103/status":
			io.WriteString(w, `{"id":"103","status":"succeeded"}`)
		case "/v1/jobs/103":
			io.WriteString(w, `{"id":"103","status":"failed","error":{"code":"execution_failed"}}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	job, err := client.WaitJob(context.Background(), "103", WaitOptions{PollInterval: time.Millisecond})
	if !errors.Is(err, ErrJobStateInconsistent) {
		t.Fatalf("expected ErrJobStateInconsistent, got %v", err)
	}
	if job.ID != "" || job.Status != "" {
		t.Fatalf("expected zero Job on inconsistent terminal state, got %+v", job)
	}
}

func TestWaitJobTimeoutAndRecoverySameJob(t *testing.T) {
	var cancelCalls, submitCalls atomic.Int32
	var phase atomic.Int32 // 0: initial (always running), 1: recovery (terminal succeeded)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/jobs/104/cancel" {
			cancelCalls.Add(1)
		}
		if r.URL.Path == "/v1/images/generations" || r.URL.Path == "/v1/videos/generations" {
			submitCalls.Add(1)
		}
		switch r.URL.Path {
		case "/v1/jobs/104/status":
			if phase.Load() == 0 {
				io.WriteString(w, `{"id":"104","status":"running"}`)
			} else {
				io.WriteString(w, `{"id":"104","status":"succeeded"}`)
			}
		case "/v1/jobs/104":
			io.WriteString(w, `{"id":"104","status":"succeeded","billing":{"currency":"USD","total_charged_by_yir":"0.05"}}`)
		}
	}))
	defer server.Close()

	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})

	// 第一次：等待时在 OnPoll 中触发 cancel，保证初次始终处于 running
	ctx, cancel := context.WithCancel(context.Background())
	var polledFirst atomic.Int32
	job, err := client.WaitJob(ctx, "104", WaitOptions{
		PollInterval: time.Millisecond,
		OnPoll: func(s JobStatusResponse) {
			if polledFirst.Add(1) == 1 {
				cancel()
			}
		},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if job.ID != "" || job.Status != "" {
		t.Fatalf("expected zero Job on context cancel, got %+v", job)
	}
	if cancelCalls.Load() != 0 || submitCalls.Load() != 0 {
		t.Fatalf("timeout/cancel must not call Submit or Cancel, submitCalls=%d cancelCalls=%d", submitCalls.Load(), cancelCalls.Load())
	}

	// 切换到恢复阶段：返回 terminal succeeded
	phase.Store(1)

	// 恢复：用同一 Job ID 继续等待并成功
	recoveredJob, err := client.WaitJob(context.Background(), "104", WaitOptions{PollInterval: time.Millisecond})
	if err != nil {
		t.Fatalf("unexpected recovery error: %v", err)
	}
	if recoveredJob.ID != "104" || recoveredJob.Status != "succeeded" {
		t.Fatalf("unexpected recovered job: %+v", recoveredJob)
	}
	if cancelCalls.Load() != 0 || submitCalls.Load() != 0 {
		t.Fatalf("recovery must not call Submit or Cancel, submitCalls=%d cancelCalls=%d", submitCalls.Load(), cancelCalls.Load())
	}
}

func TestGetJobStatusNotFoundDoesNotFallback(t *testing.T) {
	var detailCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/jobs/999" {
			detailCalls.Add(1)
		}
		if r.URL.Path == "/v1/jobs/999/status" {
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"error":{"code":"YIR_JOB_NOT_FOUND","message":"Job not found","retryable":false}}`)
			return
		}
	}))
	defer server.Close()

	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	_, err := client.GetJobStatus(context.Background(), "999")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 404 || apiErr.Code != "YIR_JOB_NOT_FOUND" {
		t.Fatalf("expected 404 APIError, got %v", err)
	}
	if detailCalls.Load() != 0 {
		t.Fatal("404 status must not silently fallback to detail endpoint")
	}

	// WaitJob 遇到 404 同样直接报错，不静默回退
	job, err := client.WaitJob(context.Background(), "999", WaitOptions{})
	if !errors.As(err, &apiErr) || apiErr.Status != 404 {
		t.Fatalf("expected WaitJob to propagate 404 error, got %v", err)
	}
	if job.ID != "" || job.Status != "" {
		t.Fatalf("expected zero Job on 404, got %+v", job)
	}
	if detailCalls.Load() != 0 {
		t.Fatal("WaitJob 404 status must not fallback to detail endpoint")
	}
}
