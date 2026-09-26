package yir

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientQuoteBatchPreservesOrderAndItemErrors(t *testing.T) {
	requests := []QuoteBatchRequestItem{
		{Operation: "generate_image", Request: imageRequest()},
		{Operation: "generate_video", Request: GenerationRequest{Model: "bytedance/seedance-2.5", Input: GenerationInput{Type: "text", Prompt: "video"}}},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/quotes" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Requests []QuoteBatchRequestItem `json:"requests"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Requests) != 2 || body.Requests[0].Request.Parameters == nil {
			t.Errorf("invalid request envelope: %+v %v", body, err)
		}
		io.WriteString(w, `{"object":"quote_batch","request_id":"test","data":[{"index":0,"quote":{"object":"quote","model":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","parameters":{},"currency":"USD","expires_at":3000000000,"has_verifiable_upper_bound":true,"single_attempt_upper_bound":"0.05","primary":{"kind":"fixed","amount":"0.02"},"max":{"kind":"fixed","amount":"0.05"},"official":{"kind":"unavailable","amount":null,"reason":"official_price_unavailable"}}},{"index":1,"error":{"code":"YIR_INVALID_REQUEST","message":"The request is invalid.","retryable":false,"action":"fix_request"}}]}`)
	}))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	batch, err := client.QuoteBatch(context.Background(), requests)
	if err != nil || batch.Data[0].Quote == nil || batch.Data[1].Error == nil || batch.Data[1].Error.Code != "YIR_INVALID_REQUEST" {
		t.Fatalf("batch: %+v %v", batch, err)
	}
	if got := batch.Data[1].Error.Error(); got != "yir: YIR_INVALID_REQUEST" {
		t.Fatalf("item error must not invent an HTTP status: %s", got)
	}
	if requests[0].Request.Parameters != nil {
		t.Fatal("mutated caller request")
	}
}

func TestClientQuoteBatchRejectsInvalidEnvelope(t *testing.T) {
	request := []QuoteBatchRequestItem{{Operation: "generate_image", Request: imageRequest()}}
	for _, body := range []string{
		`{"object":"quote_batch","request_id":"test","data":[]}`,
		`{"object":"quote_batch","request_id":"test","data":[{"index":1,"error":{"code":"YIR_INVALID_REQUEST","message":"bad","action":"fix_request"}}]}`,
		`{"object":"quote_batch","request_id":"test","data":[{"index":0,"error":{"code":"YIR_TEMPORARILY_UNAVAILABLE","message":"bad","retryable":true,"action":"retry_later"}}]}`,
	} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, body) }))
			defer server.Close()
			client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
			if _, err := client.QuoteBatch(context.Background(), request); err == nil || err.Error() != "quote_batch_response_invalid" {
				t.Fatalf("error: %v", err)
			}
		})
	}
	client, _ := NewClient("test-key", ClientOptions{})
	if _, err := client.QuoteBatch(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "quote_batch_request_invalid") {
		t.Fatalf("empty batch: %v", err)
	}
}
