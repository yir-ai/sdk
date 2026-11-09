package yir

import (
	"errors"
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
