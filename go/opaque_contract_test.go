package yir

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestJobIDsAreOpaque(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/jobs/job_01HZX" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"id":"job_01HZX","object":"job","status":"queued","model":"openai/gpt-image-2","error":null,"created_at":1}`))
	}))
	defer server.Close()
	client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetJob(context.Background(), "job_01HZX"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"", ".", "..", " 7001", "a/b", "a?b", "a#b", "a%2fb"} {
		if _, err := client.GetJob(context.Background(), id); err == nil || err.Error() != "job_id_invalid" {
			t.Fatalf("%q: %v", id, err)
		}
	}
}

func TestAPIErrorCarriesFieldDetails(t *testing.T) {
	err := responseAPIError(400, []byte(`{"error":{"code":"YIR_INVALID_REQUEST","message":"parameters.resolution is not supported.","retryable":false,"action":"fix_request","details":[{"field":"parameters.resolution","reason":"unsupported","allowed":["1K","2K"]}]},"request_id":"req_1"}`))
	var apiErr *APIError
	if !errors.As(err, &apiErr) || len(apiErr.Details) != 1 {
		t.Fatalf("details not decoded: %#v", err)
	}
	detail := apiErr.Details[0]
	if detail.Field != "parameters.resolution" || detail.Reason != "unsupported" || len(detail.Allowed) != 2 {
		t.Fatalf("unexpected detail %#v", detail)
	}
}

func TestQuoteMayEchoCanonicalModelForAlias(t *testing.T) {
	request := GenerationRequest{Model: "gpt-image-2", Input: GenerationInput{Type: "text", Prompt: "fixture"}}
	quote := Quote{Model: "openai/gpt-image-2", Operation: "generate_image", InputMode: "text"}
	var client *Client
	if !client.quoteMatchesRequest(quote, request, "generate_image") {
		t.Fatal("canonical echo for an alias must be accepted without a catalog")
	}
	catalog := bundledModelContractCatalog
	client = &Client{modelContracts: &catalog}
	if !client.quoteMatchesRequest(quote, request, "generate_image") {
		t.Fatal("catalog-resolved alias must match")
	}
	quote.Model = "openai/gpt-image-1"
	if client.quoteMatchesRequest(quote, request, "generate_image") {
		t.Fatal("a different known model must be rejected")
	}
	var bare *Client
	if bare.quoteMatchesRequest(Quote{Model: "nano banana", Operation: "generate_image", InputMode: "text"}, request, "generate_image") {
		t.Fatal("without a catalog a different echo must be a canonical creator/model ID")
	}
}
