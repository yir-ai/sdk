package yir

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQuoteVideoSendsDeclaredDurationAndReadsSource(t *testing.T) {
	var body struct {
		Input struct {
			References []map[string]json.RawMessage `json:"references"`
		} `json:"input"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		io.WriteString(w, `{"object":"quote","supply":{"available":true,"issues":[]},"model":"bytedance/seedance-2.0","operation":"generate_video","input_mode":"reference","parameters":{},"currency":"USD","expires_at":3000000000,"primary":{"kind":"fixed","amount":"0.481481"},"expected_amount":"0.481481","input_duration_source":"declared","official":{"kind":"unavailable","amount":null,"reason":"official_price_unavailable"}}`)
	}))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	seconds := 6.037
	quote, err := client.QuoteVideo(context.Background(), GenerationRequest{Model: "bytedance/seedance-2.0", Parameters: map[string]any{},
		Input: GenerationInput{Type: "reference", Prompt: "dance", References: []Reference{
			{Role: "reference_image", URL: "https://example.com/a.png"},
			{Role: "reference_video", URL: "https://example.com/a.mp4", DurationSeconds: &seconds},
		}}})
	if err != nil {
		t.Fatal(err)
	}
	if quote.InputDurationSource != "declared" || quote.ExpectedAmount == nil || *quote.ExpectedAmount != "0.481481" {
		t.Fatalf("unexpected quote: %+v", quote)
	}
	if len(body.Input.References) != 2 || string(body.Input.References[1]["duration_seconds"]) != "6.037" {
		t.Fatalf("declared duration not sent: %v", body.Input.References)
	}
	if _, ok := body.Input.References[0]["duration_seconds"]; ok {
		t.Fatal("undeclared reference must omit duration_seconds")
	}
}
