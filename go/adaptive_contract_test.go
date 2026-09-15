package yir

import (
	"reflect"
	"testing"
)

func TestSeedanceAdaptiveRatio(t *testing.T) {
	contract, _ := GetModelOperationContract("bytedance/seedance-2.0", "generate_video", "text")
	for _, rule := range contract.Parameters {
		if rule.Name == "aspect_ratio" {
			if rule.Default != "16:9" || !reflect.DeepEqual(rule.Values, []any{"21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"}) {
				t.Fatalf("unexpected ratio contract: %+v", rule)
			}
		}
	}
	for _, mode := range contract.InputModes {
		for _, ratio := range []string{"21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive", "invalid"} {
			request := GenerationRequest{Model: "bytedance/seedance-2.0", Input: GenerationInput{Type: mode, Prompt: "fixture"}, Parameters: map[string]any{"aspect_ratio": ratio, "return_last_frame": true}}
			if mode != "text" {
				role := "reference_image"
				if mode == "image" {
					role = "first_frame"
				}
				request.Input.References = []Reference{{Role: role, URL: "https://example.com/input.png"}}
			}
			if err := ValidateGeneration("generate_video", request); (err == nil) != (ratio != "invalid") {
				t.Fatalf("%s %s: %v", mode, ratio, err)
			}
			if request.Parameters["aspect_ratio"] != ratio {
				t.Fatal("ratio mutated")
			}
		}
	}
}
