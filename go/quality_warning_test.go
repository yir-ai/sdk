package yir

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

// GPT Image quality is a server-side routing constraint, so no routing triggers a warning.
func TestGPTImageQualityNoLongerWarns(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	for _, only := range [][]string{nil, {"apimart"}, {"openai", "apimart"}, {"openai"}} {
		output.Reset()
		request := imageRequest()
		request.Input.Prompt = "private prompt"
		request.Parameters = map[string]any{"quality": "high"}
		request.Routing = &Routing{Only: only}
		warnParameterPolicies("generate_image", request)
		if output.Len() > 0 {
			t.Fatalf("only=%v: %q", only, output.String())
		}
		if strings.Contains(output.String(), "private prompt") {
			t.Fatal("input leaked")
		}
		if request.Parameters["quality"] != "high" {
			t.Fatal("request mutated")
		}
	}
}

func TestParameterPolicyCopyIsolation(t *testing.T) {
	contract, ok := GetModelOperationContract("gpt-image-2", "generate_image", "text")
	if !ok {
		t.Fatal("missing contract")
	}
	for _, parameter := range contract.Parameters {
		if parameter.Policy != nil {
			parameter.Policy.Message = "changed"
		}
	}
	fresh, _ := GetModelOperationContract("gpt-image-2", "generate_image", "text")
	for _, parameter := range fresh.Parameters {
		if parameter.Policy != nil && parameter.Policy.Message == "changed" {
			t.Fatal("policy copy mutated registry")
		}
	}
}
