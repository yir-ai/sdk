package yir

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func musicRequest() GenerationRequest {
	return GenerationRequest{Model: "music-2.6", Input: GenerationInput{Type: "text", Prompt: "A warm acoustic folk ballad",
		Lyrics: "[Verse]\nWalking down a dusty road"}}
}

func musicQuoteResponse(parameters map[string]any) map[string]any {
	amount := "0.15"
	if parameters["lyrics_optimizer"] == true {
		amount = "0.16"
	}
	// A music echo carries no resolution or aspect_ratio.
	return map[string]any{"supply": map[string]any{"available": true, "issues": []string{}}, "object": "quote",
		"model": "minimax/music-2.6", "operation": "generate_music", "input_mode": "text",
		"parameters": map[string]any{"instrumental": false, "lyrics_optimizer": parameters["lyrics_optimizer"] == true, "n": 1},
		"currency":   "USD", "expires_at": 3000000000,
		"primary": map[string]any{"kind": "fixed", "amount": amount}, "official": map[string]any{"kind": "fixed", "amount": "0.15"}}
}

func TestMusicQuoteAndSubmitUseMusicPaths(t *testing.T) {
	var paths []string
	var bodies []map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		bodies = append(bodies, body)
		if r.URL.Path == "/v1/music/quotes" {
			var parameters map[string]any
			json.Unmarshal(body["parameters"], &parameters)
			json.NewEncoder(w).Encode(musicQuoteResponse(parameters))
			return
		}
		if r.Header.Get("Idempotency-Key") != "music-key" {
			t.Error("idempotency key lost")
		}
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]any{"object": "job", "id": "7101", "status": "queued", "model": "minimax/music-2.6"})
	}))
	defer server.Close()
	for _, catalog := range []*ModelContractCatalog{nil, testModelContracts()} {
		paths, bodies = nil, nil
		client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL, ModelContracts: catalog})
		if err != nil {
			t.Fatal(err)
		}
		quote, err := client.QuoteMusic(context.Background(), musicRequest())
		if err != nil || quote.Operation != "generate_music" || *quote.Primary.Amount != "0.15" {
			t.Fatalf("music quote: %+v %v", quote, err)
		}
		if _, ok := quote.Parameters["resolution"]; ok {
			t.Fatal("music echo has resolution")
		}
		optimized := GenerationRequest{Model: "music-2.6", Input: GenerationInput{Type: "text", Prompt: "A ballad"},
			Parameters: map[string]any{"lyrics_optimizer": true}}
		if quote, err = client.QuoteMusic(context.Background(), optimized); err != nil || *quote.Primary.Amount != "0.16" {
			t.Fatalf("optimized quote: %+v %v", quote, err)
		}
		job, err := client.SubmitMusic(context.Background(), SubmitRequest{GenerationRequest: musicRequest(), WebhookURL: "https://example.com/webhooks/yir"}, "music-key")
		if err != nil || job.ID != "7101" {
			t.Fatalf("music submit: %+v %v", job, err)
		}
		if len(paths) != 3 || paths[0] != "/v1/music/quotes" || paths[2] != "/v1/music/generations" {
			t.Fatalf("paths: %v", paths)
		}
		var input GenerationInput
		if err := json.Unmarshal(bodies[2]["input"], &input); err != nil || input.Lyrics != musicRequest().Input.Lyrics || input.Prompt != musicRequest().Input.Prompt {
			t.Fatalf("input lost: %s", bodies[2]["input"])
		}
		if string(bodies[0]["parameters"]) != "{}" || string(bodies[2]["webhook_url"]) != `"https://example.com/webhooks/yir"` {
			t.Fatalf("body drift: %s %s", bodies[0]["parameters"], bodies[2]["webhook_url"])
		}
	}
}

func TestMusicQuoteRejectsMismatchedEcho(t *testing.T) {
	for _, override := range []map[string]any{{"operation": "generate_image"}, {"input_mode": "image"}} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := musicQuoteResponse(nil)
			for key, value := range override {
				response[key] = value
			}
			json.NewEncoder(w).Encode(response)
		}))
		client, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL})
		if _, err := client.QuoteMusic(context.Background(), musicRequest()); err == nil {
			t.Fatalf("mismatched echo accepted: %v", override)
		}
		server.Close()
	}
}

func TestMusicProtocolRules(t *testing.T) {
	text := func(prompt, lyrics string, parameters map[string]any) GenerationRequest {
		return GenerationRequest{Model: "music-2.6", Input: GenerationInput{Type: "text", Prompt: prompt, Lyrics: lyrics}, Parameters: parameters}
	}
	for _, request := range []GenerationRequest{
		musicRequest(),
		text("Ballad", "[Verse]\nRain", map[string]any{"instrumental": false, "lyrics_optimizer": false, "n": 1}),
		text("Lo-fi piano", "", map[string]any{"instrumental": true}),
		text("Ballad", "", map[string]any{"lyrics_optimizer": true}),
	} {
		if err := ValidateGenerationProtocol("generate_music", request); err != nil {
			t.Fatalf("valid music request rejected: %+v %v", request, err)
		}
		if err := ValidateGenerationWithCatalog("generate_music", request, *testModelContracts()); err != nil {
			t.Fatalf("valid music request rejected by catalog: %+v %v", request, err)
		}
	}
	image := musicRequest()
	image.Input.Type = "image"
	image.Input.References = []Reference{{Role: "reference_image", URL: "https://example.com/a.png"}}
	for _, tc := range []struct {
		request    GenerationRequest
		path, code string
	}{
		{text("Ballad", "", nil), "input.lyrics", "required_parameter"},
		{text("Ballad", "[Verse]", map[string]any{"instrumental": true}), "input.lyrics", "not_allowed"},
		{text("Ballad", "[Verse]", map[string]any{"lyrics_optimizer": true}), "input.lyrics", "not_allowed"},
		{text("Ballad", "", map[string]any{"instrumental": true, "lyrics_optimizer": true}), "parameters.lyrics_optimizer", "parameter_conflict"},
		{text("Ballad", "  ", nil), "input.lyrics", "invalid_value"},
		{text("Ballad", "[Verse]", map[string]any{"instrumental": "true"}), "parameters.instrumental", "invalid_type"},
		{text(" ", "[Verse]", nil), "input.prompt", "required_parameter"},
		{image, "input.type", "input_mode_invalid"},
	} {
		var parameterError *ParameterError
		err := ValidateGenerationProtocol("generate_music", tc.request)
		if !errors.As(err, &parameterError) || parameterError.Path != tc.path || parameterError.Code != tc.code {
			t.Fatalf("%+v: got %v, want %s %s", tc.request, err, tc.path, tc.code)
		}
	}
	// The current catalog also checks parameter values.
	var parameterError *ParameterError
	if err := ValidateGenerationWithCatalog("generate_music", text("Ballad", "[Verse]", map[string]any{"n": 2}), *testModelContracts()); !errors.As(err, &parameterError) {
		t.Fatalf("n=2 accepted: %v", err)
	}
	// Lyrics are a music field.
	lyricImage := imageRequest()
	lyricImage.Input.Lyrics = "[Verse]"
	if err := ValidateGenerationProtocol("generate_image", lyricImage); !errors.As(err, &parameterError) || parameterError.Path != "input.lyrics" {
		t.Fatalf("image lyrics accepted: %v", err)
	}
}

func TestMusicContractAndResultDuration(t *testing.T) {
	contract, ok := GetModelOperationContract("music-2.6", "generate_music", "text")
	if !ok || len(contract.Parameters) != 3 {
		t.Fatalf("music contract: %+v %v", contract, ok)
	}
	var job Job
	raw := `{"object":"job","id":"7101","status":"succeeded","model":"minimax/music-2.6","error":null,"created_at":1,
		"result":{"availability":"available","files":[{"url":"https://example.com/a.mp3","media_type":"audio/mpeg","duration_ms":183250,"expires_at":2}]}}`
	if err := json.Unmarshal([]byte(raw), &job); err != nil || job.Result.Files[0].DurationMS != 183250 {
		t.Fatalf("duration lost: %+v %v", job.Result, err)
	}
}
