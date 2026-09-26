package yir

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestProSearchContractAndTransport(t *testing.T) {
	var calls []GenerationRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request GenerationRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		calls = append(calls, request)
		if r.URL.Path == "/v1/images/quotes" {
			unavailable := map[string]any{"kind": "unavailable", "amount": nil, "reason": "search_not_supported"}
			json.NewEncoder(w).Encode(map[string]any{"object": "quote", "model": request.Model, "operation": "generate_image", "input_mode": request.Input.Type, "parameters": request.Parameters, "currency": "USD", "expires_at": 3000000000, "primary": unavailable, "max": unavailable, "official": unavailable, "has_verifiable_upper_bound": false, "single_attempt_upper_bound": nil})
		} else {
			if r.URL.Path != "/v1/images/generations" || r.Header.Get("Idempotency-Key") != "pro-key" {
				t.Error("unexpected submission")
			}
			json.NewEncoder(w).Encode(map[string]any{"object": "job", "id": "1", "status": "queued"})
		}
	}))
	defer server.Close()
	client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL, ModelContracts: testModelContracts()})
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"text", "image"} {
		contract, _ := GetModelOperationContract("google/nano-banana-pro", "generate_image", mode)
		found := false
		for _, rule := range contract.Parameters {
			if rule.Name == "image_search" {
				t.Fatal("Pro exposes image search")
			}
			if rule.Name == "web_search" {
				found = rule.Type == "boolean" && !rule.Required && rule.Default == false
			}
		}
		if !found {
			t.Fatal("missing optional web search default")
		}
		for _, tc := range []struct {
			parameters map[string]any
			code       string
		}{
			{map[string]any{}, ""}, {map[string]any{"web_search": false}, ""}, {map[string]any{"web_search": true}, ""},
			{map[string]any{"image_search": false}, "unknown_parameter"}, {map[string]any{"web_search": true, "image_search": true}, "unknown_parameter"},
			{map[string]any{"web_search": "true"}, "invalid_type"}, {map[string]any{"web_search": nil}, "invalid_type"},
		} {
			request := GenerationRequest{Model: "google/nano-banana-pro", Input: GenerationInput{Type: mode, Prompt: "fixture"}, Parameters: tc.parameters}
			if mode == "image" {
				request.Input.References = []Reference{{Role: "reference_image", URL: "https://example.com/input.png"}}
			}
			before, _ := json.Marshal(request)
			count := len(calls)
			quote, quoteErr := client.QuoteImage(context.Background(), request)
			// Exercise serialization independently; an unavailable quote is not submission authorization.
			_, submitErr := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: request}, "pro-key")
			for _, err := range []error{quoteErr, submitErr, ValidateModelParameters(request.Model, "generate_image", mode, tc.parameters)} {
				var parameter *ParameterError
				if tc.code == "" {
					if err != nil {
						t.Fatal(err)
					}
				} else if !errors.As(err, &parameter) || parameter.Code != tc.code {
					t.Fatalf("got %v, want %s", err, tc.code)
				}
			}
			if tc.code != "" {
				if len(calls) != count {
					t.Fatal("invalid search reached transport")
				}
			} else {
				if quote.Primary.Kind != "unavailable" || quote.Primary.Amount != nil {
					t.Fatal("unavailable quote changed")
				}
				if len(calls) != count+2 {
					t.Fatal("missing transport")
				}
				for _, call := range calls[count:] {
					if !reflect.DeepEqual(call.Parameters, tc.parameters) {
						t.Fatal("parameters changed")
					}
				}
			}
			after, _ := json.Marshal(request)
			if string(before) != string(after) {
				t.Fatal("request mutated")
			}
		}
	}
}
