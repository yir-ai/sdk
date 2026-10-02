package yir

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Fields newer than this SDK, including nested ones, stay readable without a release.
func TestResponsesKeepRawJSON(t *testing.T) {
	const job = `{"id":"7","status":"succeeded","future_top":1,"billing":{"currency":"USD","total_charged_by_yir":"0.02","future_fee":"0.01"}}`
	const file = `{"id":"` + testFileID + `","object":"file","status":"ready","name":"a.png","media_type":"image/png","size":1,"future_hash":"abc"}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/jobs/7":
			io.WriteString(w, job)
		case "/v1/jobs/7/status":
			io.WriteString(w, `{"id":"7","status":"running","future_progress":0.5}`)
		case "/v1/files/" + testFileID:
			io.WriteString(w, file)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	got, err := client.GetJob(context.Background(), "7")
	if err != nil || string(got.RawJSON()) != job || got.Billing.TotalChargedByYir != "0.02" {
		t.Fatalf("job=%+v raw=%s err=%v", got, got.RawJSON(), err)
	}
	var extra struct {
		Billing struct {
			FutureFee string `json:"future_fee"`
		} `json:"billing"`
	}
	if err := json.Unmarshal(got.RawJSON(), &extra); err != nil || extra.Billing.FutureFee != "0.01" {
		t.Fatalf("nested field lost: %+v %v", extra, err)
	}
	status, err := client.GetJobStatus(context.Background(), "7")
	if err != nil || string(status.RawJSON()) != `{"id":"7","status":"running","future_progress":0.5}` {
		t.Fatalf("status raw=%s err=%v", status.RawJSON(), err)
	}
	readFile, err := client.GetFile(context.Background(), testFileID)
	if err != nil || string(readFile.RawJSON()) != file {
		t.Fatalf("file raw=%s err=%v", readFile.RawJSON(), err)
	}
	// Values built in code have no response body, and the types stay comparable.
	if (Job{}).RawJSON() != nil || (Quote{}).RawJSON() != nil || (File{}) != (File{}) || (JobStatusResponse{}) != (JobStatusResponse{}) {
		t.Fatal("zero values changed")
	}
}

func TestQuoteAndModelDetailKeepRawJSON(t *testing.T) {
	var quote Quote
	if err := json.Unmarshal([]byte(`{"object":"quote","currency":"USD","future_discount":"0.01"}`), &quote); err != nil ||
		string(quote.RawJSON()) != `{"object":"quote","currency":"USD","future_discount":"0.01"}` {
		t.Fatalf("quote raw=%s err=%v", quote.RawJSON(), err)
	}
	client, _ := modelDetailClient(t, testModelDetail, 200)
	detail, err := client.GetModel(context.Background(), "openai/gpt-image-2")
	if err != nil || string(detail.RawJSON()) != testModelDetail {
		t.Fatalf("detail raw err=%v", err)
	}
}

func TestAPIErrorCarriesRequestID(t *testing.T) {
	for _, tc := range []struct{ body, code string }{
		{`{"error":{"code":"YIR_JOB_NOT_FOUND","message":"missing","retryable":false},"request_id":"req_123"}`, "YIR_JOB_NOT_FOUND"},
		{`{"request_id":"req_123"}`, "http_error"},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, tc.body)
		}))
		client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
		_, err := client.GetJob(context.Background(), "7")
		server.Close()
		var apiError *APIError
		if !errors.As(err, &apiError) || apiError.Code != tc.code || apiError.Status != 404 || apiError.RequestID != "req_123" {
			t.Fatalf("%s: %#v", tc.body, err)
		}
	}
}
