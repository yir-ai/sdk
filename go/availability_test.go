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

func TestClientStaleCatalogAllowsNewParameters(t *testing.T) {
	request := imageRequest()
	request.Parameters = map[string]any{"future_parameter": true, "resolution": "future-resolution"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var received SubmitRequest
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		if received.Parameters["future_parameter"] != true {
			t.Error("parameter was removed")
		}
		io.WriteString(w, `{"id":"fixture","status":"queued"}`)
	}))
	defer server.Close()
	client, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL, ModelContracts: testModelContracts()})
	if _, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: request}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateGenerationWithCatalog("generate_image", request, *testModelContracts()); err == nil {
		t.Fatal("explicit validation lost")
	}
}

func TestSubmissionErrorPreservesKeyAndAPIError(t *testing.T) {
	var key string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key = r.Header.Get("Idempotency-Key")
		w.WriteHeader(400)
		io.WriteString(w, `{"error":{"code":"YIR_INVALID_REQUEST","message":"fixture"}}`)
	}))
	defer server.Close()
	client, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	_, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: imageRequest()})
	var submission *SubmissionError
	var api *APIError
	if !errors.As(err, &submission) || submission.IdempotencyKey != key || key == "" {
		t.Fatalf("missing identity: %v", err)
	}
	if !errors.As(err, &api) || api.Code != ErrCodeInvalidRequest {
		t.Fatalf("lost API error: %v", err)
	}
}

func TestGetBalanceSupportsDebt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/balance" || r.Method != "GET" {
			t.Error("wrong request")
		}
		io.WriteString(w, `{"object":"balance","currency":"USD","available_amount":"-0.1","held_amount":"0","total_amount":"-0.1","future":true}`)
	}))
	defer server.Close()
	client, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	value, err := client.GetBalance(context.Background())
	if err != nil || value.AvailableAmount != "-0.1" {
		t.Fatalf("balance=%+v err=%v", value, err)
	}
}
