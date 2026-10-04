package yir

import (
	"errors"
	"testing"
)

// Nano Banana Pro exposes no search parameters: no executable supply supports search.
func TestProSearchContractRejectsSearch(t *testing.T) {
	for _, mode := range []string{"text", "image"} {
		contract, ok := GetModelOperationContract("google/nano-banana-pro", "generate_image", mode)
		if !ok {
			t.Fatal("missing Pro contract")
		}
		for _, rule := range contract.Parameters {
			if rule.Name == "web_search" || rule.Name == "image_search" {
				t.Fatalf("Pro exposes %s", rule.Name)
			}
		}
		for _, parameters := range []map[string]any{{"web_search": true}, {"web_search": false}, {"image_search": false}} {
			var parameter *ParameterError
			if err := ValidateModelParameters("google/nano-banana-pro", "generate_image", mode, parameters); !errors.As(err, &parameter) || parameter.Code != "unknown_parameter" {
				t.Fatalf("got %v, want unknown_parameter", err)
			}
		}
	}
}
