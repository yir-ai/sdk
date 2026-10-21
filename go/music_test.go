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
	// Without a contract the model may be a sound effect, so only the catalog
	// requires a lyrics source for music.
	if err := ValidateGenerationProtocol("generate_music", text("Ballad", "", nil)); err != nil {
		t.Fatalf("protocol required lyrics: %v", err)
	}
	var parameterError *ParameterError
	if err := ValidateGenerationWithCatalog("generate_music", text("Ballad", "", nil), *testModelContracts()); !errors.As(err, &parameterError) ||
		parameterError.Path != "input.lyrics" || parameterError.Code != "required_parameter" {
		t.Fatalf("missing lyrics source accepted: %v", err)
	}
	// The current catalog also checks parameter values.
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

func TestAudioModelContractRules(t *testing.T) {
	catalog := *testModelContracts()
	request := func(model, lyrics string, parameters map[string]any) GenerationRequest {
		return GenerationRequest{Model: model, Input: GenerationInput{Type: "text", Prompt: "Rain on a tin roof", Lyrics: lyrics}, Parameters: parameters}
	}
	for _, tc := range []struct {
		operation string
		request   GenerationRequest
	}{
		{"generate_music", request("suno/suno-v6", "[Verse]\nRain", nil)},
		{"generate_music", request("suno/suno-v6", "", map[string]any{"n": 2, "lyrics_optimizer": true})},
		{"generate_music", request("elevenlabs/music-v2", "", map[string]any{"duration": 120, "instrumental": true})},
		{"generate_music", request("elevenlabs/music-v2.5", "", map[string]any{"lyrics_optimizer": true})},
		{"generate_music", request("minimax/music-3", "[Verse]\nRain", nil)},
		// The music methods also serve sound effects; no lyrics source is needed.
		{"generate_music", request("elevenlabs/sound-effects-v2", "", map[string]any{"duration": 22})},
		{"generate_sound_effect", request("elevenlabs/sound-effects-v2", "", nil)},
	} {
		if err := ValidateGenerationProtocol(tc.operation, tc.request); err != nil {
			t.Fatalf("protocol rejected %s: %v", tc.request.Model, err)
		}
		if err := ValidateGenerationWithCatalog(tc.operation, tc.request, catalog); err != nil {
			t.Fatalf("catalog rejected %s %v: %v", tc.request.Model, tc.request.Parameters, err)
		}
	}
	for _, tc := range []struct {
		request    GenerationRequest
		path, code string
	}{
		{request("suno/suno-v6", "[Verse]", map[string]any{"n": 1}), "parameters.n", "invalid_enum"},
		{request("elevenlabs/music-v2", "", map[string]any{"duration": 45, "instrumental": true}), "parameters.duration", "invalid_enum"},
		{request("elevenlabs/music-v2", "", map[string]any{"duration": 600, "instrumental": true}), "parameters.duration", "above_maximum"},
		{request("elevenlabs/music-v2", "", nil), "input.lyrics", "required_parameter"},
		{request("elevenlabs/sound-effects-v2", "", map[string]any{"duration": 23}), "parameters.duration", "above_maximum"},
		{request("elevenlabs/sound-effects-v2", "", map[string]any{"instrumental": true}), "parameters.instrumental", "unknown_parameter"},
		{request("elevenlabs/sound-effects-v2", "[Verse]", nil), "input.lyrics", "not_allowed"},
		{request("minimax/music-3", "", map[string]any{"lyrics_optimizer": true}), "parameters.lyrics_optimizer", "unknown_parameter"},
		{request("minimax/music-2.6", "[Verse]", map[string]any{"duration": 60}), "parameters.duration", "unknown_parameter"},
	} {
		var parameterError *ParameterError
		err := ValidateGenerationWithCatalog("generate_music", tc.request, catalog)
		if !errors.As(err, &parameterError) || parameterError.Path != tc.path || parameterError.Code != tc.code {
			t.Fatalf("%s %v: got %v, want %s %s", tc.request.Model, tc.request.Parameters, err, tc.path, tc.code)
		}
	}
	// An explicit sound-effect operation rejects lyrics without a catalog.
	var parameterError *ParameterError
	if err := ValidateGenerationProtocol("generate_sound_effect", request("elevenlabs/sound-effects-v2", "[Verse]", nil)); !errors.As(err, &parameterError) || parameterError.Path != "input.lyrics" {
		t.Fatalf("sound-effect lyrics accepted: %v", err)
	}
}

func TestSoundEffectQuoteThroughMusicMethodsAndTwoTrackResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/music/quotes" {
			t.Errorf("path %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]any{"supply": map[string]any{"available": true, "issues": []string{}}, "object": "quote",
			"model": "elevenlabs/sound-effects-v2", "operation": "generate_sound_effect", "input_mode": "text",
			"parameters": map[string]any{"n": 1, "duration": 5}, "currency": "USD", "expires_at": 3000000000,
			"primary": map[string]any{"kind": "fixed", "amount": "0.01"}, "official": map[string]any{"kind": "fixed", "amount": "0.01"}})
	}))
	defer server.Close()
	for _, catalog := range []*ModelContractCatalog{nil, testModelContracts()} {
		client, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL, ModelContracts: catalog})
		quote, err := client.QuoteMusic(context.Background(), GenerationRequest{Model: "elevenlabs/sound-effects-v2",
			Input: GenerationInput{Type: "text", Prompt: "Glass shattering"}})
		if err != nil || quote.Operation != "generate_sound_effect" {
			t.Fatalf("sound-effect quote: %+v %v", quote, err)
		}
	}
	var job Job
	raw := `{"object":"job","id":"7201","status":"succeeded","model":"suno/suno-v6","error":null,"created_at":1,
		"result":{"availability":"available","files":[{"url":"https://example.com/a.mp3","media_type":"audio/mpeg","duration_ms":120000,"expires_at":2},
		{"url":"https://example.com/b.mp3","media_type":"audio/mpeg","duration_ms":118000,"expires_at":2}]}}`
	if err := json.Unmarshal([]byte(raw), &job); err != nil || len(job.Result.Files) != 2 || job.Result.Files[1].DurationMS != 118000 {
		t.Fatalf("two tracks lost: %+v %v", job.Result, err)
	}
}

func TestSpeechThroughMusicMethods(t *testing.T) {
	catalog := *testModelContracts()
	request := func(model, lyrics string, parameters map[string]any) GenerationRequest {
		return GenerationRequest{Model: model, Input: GenerationInput{Type: "text", Prompt: "Welcome to Yir.", Lyrics: lyrics}, Parameters: parameters}
	}
	for _, tc := range []struct {
		operation string
		request   GenerationRequest
	}{
		{"generate_music", request("minimax/speech-2.8-hd", "", nil)},
		{"generate_music", request("speech-2.8-hd", "", map[string]any{"voice": "Chinese (Mandarin)_News_Anchor"})},
		{"generate_music", request("elevenlabs/eleven-v3", "", map[string]any{"n": 1, "voice": "JBFqnCBsd6RMkjVDRZzb"})},
		{"generate_speech", request("eleven_v3", "", nil)},
	} {
		if err := ValidateGenerationProtocol(tc.operation, tc.request); err != nil {
			t.Fatalf("protocol rejected %s: %v", tc.request.Model, err)
		}
		if err := ValidateGenerationWithCatalog(tc.operation, tc.request, catalog); err != nil {
			t.Fatalf("catalog rejected %s %v: %v", tc.request.Model, tc.request.Parameters, err)
		}
	}
	for _, tc := range []struct {
		request    GenerationRequest
		path, code string
	}{
		{request("minimax/speech-2.8-hd", "[Verse]", nil), "input.lyrics", "not_allowed"},
		{request("minimax/speech-2.8-hd", "", map[string]any{"instrumental": true}), "parameters.instrumental", "unknown_parameter"},
		{request("elevenlabs/eleven-v3", "", map[string]any{"duration": 10}), "parameters.duration", "unknown_parameter"},
		{request("elevenlabs/eleven-v3", "", map[string]any{"n": 2}), "parameters.n", "invalid_enum"},
		{request("elevenlabs/eleven-v3", "", map[string]any{"voice": "bad/voice"}), "parameters.voice", "invalid_value"},
		{request("elevenlabs/eleven-v3", "", map[string]any{"voice": 7}), "parameters.voice", "invalid_type"},
		// A voice is a text-to-speech parameter; music contracts do not declare it.
		{request("minimax/music-2.6", "[Verse]", map[string]any{"voice": "English_expressive_narrator"}), "parameters.voice", "unknown_parameter"},
	} {
		var parameterError *ParameterError
		err := ValidateGenerationWithCatalog("generate_music", tc.request, catalog)
		if !errors.As(err, &parameterError) || parameterError.Path != tc.path || parameterError.Code != tc.code {
			t.Fatalf("%s %v: got %v, want %s %s", tc.request.Model, tc.request.Parameters, err, tc.path, tc.code)
		}
	}
	// An explicit speech operation rejects lyrics and music switches without a catalog.
	for _, tc := range []struct {
		request GenerationRequest
		path    string
	}{
		{request("minimax/speech-2.8-hd", "[Verse]", nil), "input.lyrics"},
		{request("minimax/speech-2.8-hd", "", map[string]any{"lyrics_optimizer": false}), "parameters.lyrics_optimizer"},
		{request("minimax/speech-2.8-hd", "", map[string]any{"duration": 30}), "parameters.duration"},
	} {
		var parameterError *ParameterError
		if err := ValidateGenerationProtocol("generate_speech", tc.request); !errors.As(err, &parameterError) || parameterError.Path != tc.path {
			t.Fatalf("speech %v accepted: %v", tc.request.Parameters, err)
		}
	}
}

func TestSpeechQuoteThroughMusicMethods(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		quote := map[string]any{"supply": map[string]any{"available": true, "issues": []string{}}, "object": "quote",
			"model": "minimax/speech-2.8-hd", "operation": "generate_speech", "input_mode": "text",
			"parameters": map[string]any{"n": 1, "voice": "English_expressive_narrator"}, "currency": "USD", "expires_at": 3000000000,
			"primary": map[string]any{"kind": "fixed", "amount": "0.0015"}, "official": map[string]any{"kind": "fixed", "amount": "0.0015"}}
		switch r.URL.Path {
		case "/v1/music/quotes":
			json.NewEncoder(w).Encode(quote)
		case "/v1/quotes":
			json.NewEncoder(w).Encode(map[string]any{"object": "quote_batch", "request_id": "req_1", "data": []any{map[string]any{"index": 0, "quote": quote}}})
		default:
			t.Errorf("path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	speech := GenerationRequest{Model: "minimax/speech-2.8-hd", Input: GenerationInput{Type: "text", Prompt: "Welcome to Yir."}}
	for _, catalog := range []*ModelContractCatalog{nil, testModelContracts()} {
		client, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL, ModelContracts: catalog})
		quote, err := client.QuoteMusic(context.Background(), speech)
		if err != nil || quote.Operation != "generate_speech" || quote.Parameters["voice"] != "English_expressive_narrator" {
			t.Fatalf("speech quote: %+v %v", quote, err)
		}
	}
	client, _ := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	batch, err := client.QuoteBatch(context.Background(), []QuoteBatchRequestItem{{Operation: "generate_speech", Request: speech}})
	if err != nil || batch.Data[0].Quote.Operation != "generate_speech" {
		t.Fatalf("speech batch: %+v %v", batch, err)
	}
}
