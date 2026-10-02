package yir

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testModelDetail = `{"id":"openai/gpt-image-2","object":"model","future_field":true,
"specifications":[{"request_model_id":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","specification_label":"1024x1024","currency":"USD",
"channels":[{"provider_code":"openai","provider_label":"OpenAI","amount_micros":40000,"availability":"available","estimated":false,"specification_label":"1024x1024"},
{"provider_code":"other","provider_label":"Other","availability":"unavailable","estimated":true,"specification_label":"1024x1024"}]}],
"channel_parameters":[{"provider":"openai","channel_variant":"default","operation":"generate_image","input_mode":"text",
"parameter_rules":{"quality":{"behavior":"supported","values":["low","high"],"description":{"zh":"质量","en":"Quality"}}}}]}`

func modelDetailClient(t *testing.T, body string, status int) (*Client, *string) {
	t.Helper()
	requested := new(string)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*requested = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	client, err := NewClient("key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	return client, requested
}

func TestGetModelReadsMarketDetailWithoutContractView(t *testing.T) {
	client, requested := modelDetailClient(t, testModelDetail, 200)
	detail, err := client.GetModel(context.Background(), "openai/gpt-image-2")
	if err != nil {
		t.Fatal(err)
	}
	if *requested != "/v1/models/openai/gpt-image-2" {
		t.Fatalf("unexpected path %q", *requested)
	}
	channels := detail.Specifications[0].Channels
	if *channels[0].AmountMicros != 40000 || channels[1].AmountMicros != nil || detail.ChannelParameters[0].ParameterRules["quality"].Behavior != "supported" {
		t.Fatalf("detail decoded incorrectly: %+v", detail)
	}
}

func TestGetModelRejectsInvalidRequestsAndResponses(t *testing.T) {
	client, requested := modelDetailClient(t, testModelDetail, 200)
	for _, model := range []string{"gpt-image-2", "OpenAI/gpt-image-2", "openai/gpt-image-2?view=contract", "openai/../x"} {
		if _, err := client.GetModel(context.Background(), model); err == nil || err.Error() != "model_request_invalid" {
			t.Fatalf("%q: %v", model, err)
		}
	}
	if *requested != "" {
		t.Fatal("invalid model reached the network")
	}
	if _, err := client.GetModel(context.Background(), "openai/other"); err == nil || err.Error() != "model_response_invalid" {
		t.Fatalf("id mismatch accepted: %v", err)
	}
	for _, body := range []string{
		`{"id":"openai/gpt-image-2","object":"model","specifications":[]}`,
		`{"id":"openai/gpt-image-2","object":"model_contract","specifications":[{"request_model_id":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","specification_label":"x","currency":"USD","channels":[{"provider_code":"a","provider_label":"A","availability":"available","estimated":false,"specification_label":"x"}]}]}`,
		`{"id":"openai/gpt-image-2","object":"model","specifications":[{"request_model_id":"openai/gpt-image-2","operation":"","input_mode":"text","specification_label":"x","currency":"USD","channels":[{"provider_code":"a","provider_label":"A","availability":"available","estimated":false,"specification_label":"x"}]}]}`,
		`{"id":"openai/gpt-image-2","object":"model","specifications":[{"request_model_id":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","specification_label":"x","currency":"USD","channels":[{"provider_code":"a","provider_label":"A","availability":"","estimated":false,"specification_label":"x"}]}]}`,
		`{"id":"openai/gpt-image-2","object":"model","specifications":[{"request_model_id":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","specification_label":"x","currency":"USD","channels":[{"provider_code":"a","provider_label":"A","availability":"available","specification_label":"x"}]}]}`,
		`{"id":"openai/gpt-image-2","object":"model","specifications":[{"request_model_id":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","specification_label":"x","currency":"USD","channels":[{"provider_code":"a","provider_label":"A","availability":"available","estimated":false,"specification_label":"x"}]}],"channel_parameters":[{"provider":"a","channel_variant":"default","operation":"generate_image","input_mode":"text"}]}`,
	} {
		bad, _ := modelDetailClient(t, body, 200)
		if _, err := bad.GetModel(context.Background(), "openai/gpt-image-2"); err == nil || err.Error() != "model_response_invalid" {
			t.Fatalf("invalid detail accepted: %v", err)
		}
	}
}

// Values newer than this SDK are data, not a broken response; TypeScript accepts them too.
func TestGetModelAcceptsNewerValues(t *testing.T) {
	body := `{"id":"openai/gpt-image-2","object":"model","specifications":[{"request_model_id":"openai/gpt-image-2","operation":"upscale_image","input_mode":"video","specification_label":"x","currency":"EUR",
"channels":[{"provider_code":"a","provider_label":"A","availability":"limited","estimated":false,"specification_label":"x"}]}],
"channel_parameters":[{"provider":"a","channel_variant":"default","operation":"upscale_image","input_mode":"video","parameter_rules":{"quality":{"behavior":"clamped"}}}]}`
	client, _ := modelDetailClient(t, body, 200)
	detail, err := client.GetModel(context.Background(), "openai/gpt-image-2")
	if err != nil || detail.Specifications[0].InputMode != "video" || detail.Specifications[0].Channels[0].Availability != "limited" ||
		detail.ChannelParameters[0].ParameterRules["quality"].Behavior != "clamped" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
	for _, bad := range []string{
		strings.Replace(body, `"behavior":"clamped"`, `"behavior":""`, 1),
		strings.Replace(body, `"input_mode":"video","parameter_rules"`, `"input_mode":"","parameter_rules"`, 1),
	} {
		client, _ := modelDetailClient(t, bad, 200)
		if _, err := client.GetModel(context.Background(), "openai/gpt-image-2"); err == nil || err.Error() != "model_response_invalid" {
			t.Fatalf("empty value accepted: %v", err)
		}
	}
}

func TestGetModelReturnsNotFoundAPIError(t *testing.T) {
	client, _ := modelDetailClient(t, `{"error":{"code":"YIR_MODEL_NOT_FOUND","message":"The model was not found.","retryable":false,"action":"fix_request"}}`, 404)
	_, err := client.GetModel(context.Background(), "openai/missing")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 404 || apiErr.Code != "YIR_MODEL_NOT_FOUND" {
		t.Fatalf("unexpected error %v", err)
	}
}
