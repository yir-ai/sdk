package yir

import (
	"fmt"
	"testing"
)

func TestReferenceRoleContract(t *testing.T) {
	for _, tc := range []struct {
		images, videos, audios int
		valid                  bool
	}{
		{9, 3, 3, true}, {10, 0, 0, false}, {1, 4, 0, false}, {1, 0, 4, false}, {0, 0, 1, false},
	} {
		r := GenerationRequest{Model: "bytedance/seedance-2", Input: GenerationInput{Type: "reference", Prompt: "fixture"}}
		for role, count := range map[string]int{"reference_image": tc.images, "reference_video": tc.videos, "reference_audio": tc.audios} {
			for i := 0; i < count; i++ {
				r.Input.References = append(r.Input.References, Reference{Role: role, URL: fmt.Sprintf("https://example.com/%s/%d", role, i)})
			}
		}
		if err := ValidateGeneration("generate_video", r); (err == nil) != tc.valid {
			t.Fatalf("%+v: %v", tc, err)
		}
	}
}

func TestReferenceOutputDurationContract(t *testing.T) {
	for _, tc := range []struct {
		role     string
		duration int
		valid    bool
	}{{"reference_video", 10, true}, {"reference_video", 11, false}, {"reference_image", 11, true}} {
		r := GenerationRequest{Model: "alibaba/wan-2.7", Input: GenerationInput{Type: "reference", Prompt: "fixture", References: []Reference{{Role: tc.role, URL: "https://example.com/fixture"}}}, Parameters: map[string]any{"duration": tc.duration}}
		if err := ValidateGeneration("generate_video", r); (err == nil) != tc.valid {
			t.Fatalf("%+v: %v", tc, err)
		}
	}
}

func TestReferenceDuplicatesAndContractIsolation(t *testing.T) {
	reference := Reference{Role: "reference_image", URL: "https://example.com/fixture"}
	request := GenerationRequest{Model: "bytedance/seedance-2", Input: GenerationInput{Type: "reference", Prompt: "fixture", References: []Reference{reference, reference}}}
	if err := ValidateGeneration("generate_video", request); err == nil {
		t.Fatal("duplicate references accepted")
	}
	contract, ok := GetModelOperationContract(request.Model, "generate_video", "reference")
	if !ok {
		t.Fatal("missing contract")
	}
	constraint := contract.InputConstraints["reference"]
	constraint.ReferenceCountsByRole["reference_image"] = ReferenceCountRange{Maximum: 100}
	constraint.RequiredAnyReferenceRoles[0] = "invalid"
	fresh, _ := GetModelOperationContract(request.Model, "generate_video", "reference")
	if fresh.InputConstraints["reference"].ReferenceCountsByRole["reference_image"].Maximum != 9 || fresh.InputConstraints["reference"].RequiredAnyReferenceRoles[0] == "invalid" {
		t.Fatal("returned contract mutation escaped into the bundled catalog")
	}
}
