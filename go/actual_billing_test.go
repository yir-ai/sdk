package yir

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestActualBillingConsentValidation(t *testing.T) {
	request := GenerationRequest{BillingMode: "actual", Model: "bfl/flux-2-pro", Input: GenerationInput{Type: "image", Prompt: "fixture",
		References: []Reference{{Role: "reference_image", FileID: "file_11111111-1111-4111-8111-111111111111"}}}, Routing: &Routing{Only: []string{"fal"}}}
	if err := ValidateGeneration("generate_image", request); err != nil {
		t.Fatal(err)
	}
	request.BillingMode = "unknown"
	if err := ValidateGeneration("generate_image", request); err == nil {
		t.Fatal("unknown billing mode accepted")
	}
	request.BillingMode, request.Routing = "actual", nil
	if err := ValidateGeneration("generate_image", request); err == nil {
		t.Fatal("missing explicit channels accepted")
	}
	request.Routing = &Routing{Only: []string{"fal"}}
	cap := "0.1"
	client, err := NewClient("fixture", ClientOptions{HTTPClient: &http.Client{Transport: actualBillingNoNetwork{t}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: request, MaxCost: &cap}, "actual-conflict")
	var parameter *ParameterError
	if !errors.As(err, &parameter) || parameter.Path != "max_cost" || parameter.Code != "billing_mode_conflict" {
		t.Fatalf("expected local billing conflict, got %v", err)
	}
}

type actualBillingNoNetwork struct{ t *testing.T }

func (r actualBillingNoNetwork) RoundTrip(*http.Request) (*http.Response, error) {
	r.t.Error("invalid consent must fail before network access")
	return nil, errors.New("network disabled in test")
}
