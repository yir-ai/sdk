package yir

import (
	"fmt"
	"testing"
)

func TestSeedreamCompatibleContract(t *testing.T) {
	for _, mode := range []string{"text", "image"} {
		for _, resolution := range []string{"2K", "3K", "4K"} {
			for _, count := range []int{0, 1, 10, 11, 14, 15} {
				request := GenerationRequest{Model: "bytedance/seedream-5.0", Input: GenerationInput{Type: mode, Prompt: "fixture"}, Parameters: map[string]any{"resolution": resolution}}
				for i := 0; i < count; i++ {
					request.Input.References = append(request.Input.References, Reference{Role: "reference_image", URL: fmt.Sprintf("https://example.com/%d.png", i)})
				}
				valid := mode == "text" && count == 0 || mode == "image" && count >= 1 && count <= 14
				if err := ValidateGeneration("generate_image", request); (err == nil) != valid {
					t.Fatalf("%s %s count=%d: %v", mode, resolution, count, err)
				}
			}
		}
		for _, parameters := range []map[string]any{{"resolution": "8K"}, {"n": 2}, {"aspect_ratio": "5:1"}, {"web_search": false}, {"image_search": false}} {
			if err := ValidateModelParameters("bytedance/seedream-5.0", "generate_image", mode, parameters); err == nil {
				t.Fatalf("unexpected parameter expansion: %s %v", mode, parameters)
			}
		}
	}
}
