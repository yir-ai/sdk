package yir

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestGenerationValidation(t *testing.T) {
	base := GenerationRequest{Model: "openai/gpt-image-2", Input: GenerationInput{Type: "text", Prompt: "observatory"}}
	for _, tc := range []struct {
		name   string
		change func(*GenerationRequest)
		path   string
	}{
		{"valid defaults", func(r *GenerationRequest) {}, ""},
		{"unknown model", func(r *GenerationRequest) { r.Model = "future/model" }, "model"},
		{"unknown mode", func(r *GenerationRequest) { r.Input.Type = "reference" }, "input.type"},
		{"missing prompt", func(r *GenerationRequest) { r.Input.Prompt = " " }, "input.prompt"},
		{"text rejects refs", func(r *GenerationRequest) {
			r.Input.References = []Reference{{Role: "reference_image", FileID: "file_1"}}
		}, "input.references"},
		{"image needs ref", func(r *GenerationRequest) { r.Input.Type = "image" }, "input.references"},
		{"wrong role", func(r *GenerationRequest) {
			r.Input.Type = "image"
			r.Input.References = []Reference{{Role: "last_frame", FileID: "file_1"}}
		}, "input.references[0].role"},
		{"empty role", func(r *GenerationRequest) {
			r.Input.Type = "image"
			r.Input.References = []Reference{{FileID: "file_1"}}
		}, "input.references[0].role"},
		// Source formats and routing codes are Gateway facts.
		{"gateway-owned source format", func(r *GenerationRequest) {
			r.Input.Type = "image"
			r.Input.References = []Reference{{Role: "reference_image", URL: "https://example.com/a"}}
		}, ""},
		{"dynamic unknown parameter", func(r *GenerationRequest) { r.Parameters = map[string]any{"provider_key": "secret"} }, "parameters.provider_key"},
		{"gateway-owned routing values", func(r *GenerationRequest) {
			r.Routing = &Routing{Only: []string{"Future"}, Variants: map[string]string{"b": "standard"}, Preference: "speed"}
		}, ""},
		{"duplicate provider", func(r *GenerationRequest) { r.Routing = &Routing{Only: []string{"a", "a"}} }, "routing.only"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			tc.change(&r)
			err := ValidateGeneration("generate_image", r)
			if tc.path == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var field *ParameterError
			if !errors.As(err, &field) || field.Path != tc.path {
				t.Fatalf("got %v, want path %s", err, tc.path)
			}
		})
	}
}

func TestGenerationValidationPreservesReferencesAndDefaults(t *testing.T) {
	r := GenerationRequest{Model: "openai/gpt-image-2", Input: GenerationInput{Type: "image", Prompt: "merge", References: []Reference{{Role: "reference_image", FileID: "file_22222222-2222-4222-8222-222222222222"}, {Role: "reference_image", FileID: "file_11111111-1111-4111-8111-111111111111"}}}}
	before, _ := json.Marshal(r)
	if err := ValidateGeneration("generate_image", r); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(r)
	if string(before) != string(after) {
		t.Fatal("validation mutated request identity")
	}
}
