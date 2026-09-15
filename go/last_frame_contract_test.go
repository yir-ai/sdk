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

func TestLastFrameContractAndTransport(t *testing.T) {
	var calls []GenerationRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request GenerationRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		calls = append(calls, request)
		if r.URL.Path == "/v1/videos/quotes" {
			unavailable := map[string]any{"kind": "unavailable", "amount": nil, "reason": "search_not_supported"}
			json.NewEncoder(w).Encode(map[string]any{"object": "quote", "model": request.Model, "operation": "generate_video", "input_mode": request.Input.Type, "parameters": request.Parameters, "currency": "USD", "expires_at": 3000000000, "primary": unavailable, "max": unavailable, "official": unavailable, "has_verifiable_upper_bound": false, "single_attempt_upper_bound": nil})
		} else {
			if r.URL.Path != "/v1/videos/generations" || r.Header.Get("Idempotency-Key") != "tail-key" {
				t.Error("unexpected submission")
			}
			json.NewEncoder(w).Encode(map[string]any{"object": "job", "id": "1", "status": "queued"})
		}
	}))
	defer server.Close()
	client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"text", "image", "reference"} {
		contract, _ := GetModelOperationContract("bytedance/seedance-2", "generate_video", mode)
		found := false
		for _, rule := range contract.Parameters {
			if rule.Name == "image_search" {
				t.Fatal("Seedance exposes image search")
			}
			if rule.Name == "return_last_frame" {
				found = rule.Type == "boolean" && !rule.Required && rule.Default == false
			}
		}
		if !found {
			t.Fatal("missing optional last-frame default")
		}
		for _, tc := range []struct {
			parameters map[string]any
			code       string
		}{
			{map[string]any{}, ""}, {map[string]any{"return_last_frame": false}, ""}, {map[string]any{"return_last_frame": true}, ""},
			{map[string]any{"image_search": false}, "unknown_parameter"}, {map[string]any{"return_last_frame": true, "image_search": true}, "unknown_parameter"},
			{map[string]any{"return_last_frame": "true"}, "invalid_type"}, {map[string]any{"return_last_frame": nil}, "invalid_type"},
		} {
			request := GenerationRequest{Model: "bytedance/seedance-2", Input: GenerationInput{Type: mode, Prompt: "fixture"}, Parameters: tc.parameters}
			if mode != "text" {
				role := "reference_image"
				if mode == "image" {
					role = "first_frame"
				}
				request.Input.References = []Reference{{Role: role, URL: "https://example.com/input.png"}}
			}
			before, _ := json.Marshal(request)
			count := len(calls)
			quote, quoteErr := client.QuoteVideo(context.Background(), request)
			// Exercise serialization independently; an unavailable quote is not submission authorization.
			_, submitErr := client.SubmitVideo(context.Background(), SubmitRequest{GenerationRequest: request}, "tail-key")
			for _, err := range []error{quoteErr, submitErr, ValidateModelParameters(request.Model, "generate_video", mode, tc.parameters)} {
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

func TestLastFrameRejectsOtherModels(t *testing.T) {
	for _, model := range ListModelContracts() {
		if model.ID == "bytedance/seedance-2.0" {
			continue
		}
		for _, op := range model.Operations {
			for _, mode := range op.InputModes {
				for _, value := range []bool{false, true} {
					err := ValidateModelParameters(model.ID, op.Operation, mode, map[string]any{"return_last_frame": value})
					var parameter *ParameterError
					if !errors.As(err, &parameter) || parameter.Code != "unknown_parameter" {
						t.Fatalf("%s accepts last frame: %v", model.ID, err)
					}
				}
			}
		}
	}
}
