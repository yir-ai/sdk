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

func TestNanoSearchContract(t *testing.T) {
	for _, mode := range []string{"text", "image"} {
		contract, ok := GetModelOperationContract("google/nano-banana-2", "generate_image", mode)
		if !ok {
			t.Fatal("missing Nano2 contract")
		}
		for _, name := range []string{"web_search", "image_search"} {
			found := false
			for _, rule := range contract.Parameters {
				if rule.Name == name {
					found = rule.Type == "boolean" && !rule.Required && rule.Default == false
				}
			}
			if !found {
				t.Fatalf("missing optional false default: %s", name)
			}
		}
		for _, tc := range []struct {
			parameters map[string]any
			code       string
		}{
			{map[string]any{}, ""},
			{map[string]any{"web_search": false, "image_search": false}, ""},
			{map[string]any{"web_search": true}, ""},
			{map[string]any{"web_search": true, "image_search": false}, ""},
			{map[string]any{"web_search": true, "image_search": true}, ""},
			{map[string]any{"image_search": true}, "parameter_dependency"},
			{map[string]any{"web_search": false, "image_search": true}, "parameter_dependency"},
			{map[string]any{"web_search": "true"}, "invalid_type"},
			{map[string]any{"web_search": true, "image_search": nil}, "invalid_type"},
		} {
			request := GenerationRequest{Model: "google/nano-banana-2", Input: GenerationInput{Type: mode, Prompt: "fixture"}, Parameters: tc.parameters}
			if mode == "image" {
				request.Input.References = []Reference{{Role: "reference_image", URL: "https://example.com/input.png"}}
			}
			before, _ := json.Marshal(request)
			for _, err := range []error{ValidateGeneration("generate_image", request), ValidateModelParameters(request.Model, "generate_image", mode, request.Parameters)} {
				var parameter *ParameterError
				if tc.code == "" {
					if err != nil {
						t.Fatal(err)
					}
				} else if !errors.As(err, &parameter) || parameter.Code != tc.code {
					t.Fatalf("got %v, want %s", err, tc.code)
				}
			}
			after, _ := json.Marshal(request)
			if string(before) != string(after) {
				t.Fatal("validation mutated search intent")
			}
		}
	}
	// The validator accepts JSON-compatible boolean representations consistently.
	if err := ValidateModelParameters("nano-banana-2", "generate_image", "text", map[string]any{"web_search": json.RawMessage("true"), "image_search": json.RawMessage("true")}); err != nil {
		t.Fatal(err)
	}
	for _, model := range ListModelContracts() {
		if model.ID == "google/nano-banana-2" {
			continue
		}
		for _, operation := range model.Operations {
			for _, mode := range operation.InputModes {
				for _, name := range []string{"web_search", "image_search"} {
					if model.ID == "google/nano-banana-pro" && operation.Operation == "generate_image" && name == "web_search" {
						continue
					}
					err := ValidateModelParameters(model.ID, operation.Operation, mode, map[string]any{name: false})
					var parameter *ParameterError
					if !errors.As(err, &parameter) || parameter.Code != "unknown_parameter" || parameter.Path != "parameters."+name {
						t.Fatalf("%s accepts %s: %v", model.ID, name, err)
					}
				}
			}
		}
	}
}

func TestNanoSearchQuoteAndSubmit(t *testing.T) {
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
			json.NewEncoder(w).Encode(map[string]any{
				"object": "quote", "model": request.Model, "operation": "generate_image", "input_mode": request.Input.Type,
				"parameters": request.Parameters, "currency": "USD", "expires_at": 3000000000,
				"primary": unavailable, "max": unavailable, "official": unavailable,
				"has_verifiable_upper_bound": false, "single_attempt_upper_bound": nil,
			})
		} else {
			if r.URL.Path != "/v1/images/generations" || r.Header.Get("Idempotency-Key") != "saved-key" {
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
		for _, parameters := range []map[string]any{{}, {"web_search": false, "image_search": false}, {"web_search": true, "image_search": true}} {
			request := GenerationRequest{Model: "google/nano-banana-2", Input: GenerationInput{Type: mode, Prompt: "fixture"}, Parameters: parameters}
			if mode == "image" {
				request.Input.References = []Reference{{Role: "reference_image", URL: "https://example.com/input.png"}}
			}
			quote, err := client.QuoteImage(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			if quote.Primary.Kind != "unavailable" || quote.Primary.Amount != nil || quote.SingleAttemptUpperBound != nil {
				t.Fatal("unavailable quote changed")
			}
			// Independently exercise submission serialization; an unavailable quote is not authorization.
			if _, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: request}, "saved-key"); err != nil {
				t.Fatal(err)
			}
			for _, call := range calls[len(calls)-2:] {
				if !reflect.DeepEqual(call.Parameters, parameters) {
					t.Fatal("transport changed search parameters")
				}
			}
		}
	}
	before := len(calls)
	bad := GenerationRequest{Model: "google/nano-banana-2", Input: GenerationInput{Type: "text", Prompt: "fixture"}, Parameters: map[string]any{"image_search": true}}
	if _, err := client.QuoteImage(context.Background(), bad); err == nil {
		t.Fatal("invalid quote accepted")
	}
	if _, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: bad}, "saved-key"); err == nil {
		t.Fatal("invalid submit accepted")
	}
	if len(calls) != before {
		t.Fatal("invalid dependency reached transport")
	}
}
