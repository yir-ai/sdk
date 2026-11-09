package yir

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestPromptOverDeclaredLimitIsRejectedLocally(t *testing.T) {
	catalog := *testModelContracts()
	request := func(prompt string) GenerationRequest {
		return GenerationRequest{Model: "minimax/minimax-h3", Input: GenerationInput{Type: "text", Prompt: prompt}}
	}
	if err := ValidateGenerationWithCatalog("generate_video", request(strings.Repeat("字", 7000)), catalog); err != nil {
		t.Fatalf("prompt at the limit rejected: %v", err)
	}
	var parameterError *ParameterError
	err := ValidateGenerationWithCatalog("generate_video", request(strings.Repeat("字", 7001)), catalog)
	if !errors.As(err, &parameterError) || parameterError.Path != "input.prompt" || parameterError.Code != "prompt_too_long" {
		t.Fatalf("got %v, want input.prompt prompt_too_long", err)
	}
}

// Subject mode rebuilds the input constraint; the prompt limit must survive it.
func TestPromptLimitAppliesInSubjectReferenceMode(t *testing.T) {
	raw, err := json.Marshal(testModelContracts())
	if err != nil {
		t.Fatal(err)
	}
	var catalog ModelContractCatalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		t.Fatal(err)
	}
	found := false
	for i := range catalog.Models {
		if catalog.Models[i].ID != "klingai/kling-3.0" {
			continue
		}
		for j := range catalog.Models[i].Operations {
			if constraint, ok := catalog.Models[i].Operations[j].InputConstraints["reference"]; ok && constraint.SubjectReferences != nil {
				constraint.MaxPromptCharacters = 10
				catalog.Models[i].Operations[j].InputConstraints["reference"] = constraint
				found = true
			}
		}
	}
	if !found {
		t.Fatal("fixture has no subject reference mode")
	}
	photo := func(subject string, i int) Reference {
		return Reference{Role: "reference_image", URL: fmt.Sprintf("https://example.com/%s-%d.png", subject, i), Subject: subject}
	}
	request := GenerationRequest{Model: "klingai/kling-3.0", Input: GenerationInput{Type: "reference", Prompt: "@hero walks", References: []Reference{photo("hero", 1), photo("hero", 2)}}}
	var parameterError *ParameterError
	err = ValidateGenerationWithCatalog("generate_video", request, catalog)
	if !errors.As(err, &parameterError) || parameterError.Path != "input.prompt" || parameterError.Code != "prompt_too_long" {
		t.Fatalf("got %v, want input.prompt prompt_too_long", err)
	}
}
