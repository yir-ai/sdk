package yir

import "testing"

func TestQualityValidatesAgainstBundledModel(t *testing.T) {
	request := GenerationRequest{Model: "openai/gpt-image-2", Input: GenerationInput{Type: "text", Prompt: "observatory"}}
	for _, quality := range []string{"auto", "low", "medium", "high"} {
		request.Parameters = map[string]any{"quality": quality}
		if err := ValidateGeneration("generate_image", request); err != nil {
			t.Fatal(err)
		}
	}
	request.Parameters = map[string]any{"quality": "unknown"}
	if err := ValidateGeneration("generate_image", request); err == nil {
		t.Fatal("unknown quality accepted")
	}
	request.Model = "google/nano-banana-2"
	request.Parameters["quality"] = "high"
	if err := ValidateGeneration("generate_image", request); err == nil {
		t.Fatal("quality accepted without a model declaration")
	}
}
