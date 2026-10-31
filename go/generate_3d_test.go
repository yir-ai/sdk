package yir

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func text3DRequest() GenerationRequest {
	return GenerationRequest{Model: "tripo-h3.1", Input: GenerationInput{Type: "text", Prompt: "A weathered wooden armchair"},
		Parameters: map[string]any{"texture": "standard", "pbr": true}}
}

func image3DRequest(model string, references ...Reference) GenerationRequest {
	if references == nil {
		references = []Reference{{Role: "reference_image", URL: "https://example.com/chair.png"}}
	}
	return GenerationRequest{Model: model, Input: GenerationInput{Type: "image", References: references}}
}

func views3D(roles ...string) []Reference {
	references := make([]Reference, len(roles))
	for i, role := range roles {
		references[i] = Reference{Role: role, URL: "https://example.com/" + role + ".png"}
	}
	return references
}

func multiview3DRequest(model string, roles ...string) GenerationRequest {
	return GenerationRequest{Model: model, Input: GenerationInput{Type: "multiview", References: views3D(roles...)}}
}

func with3DParameters(request GenerationRequest, parameters map[string]any) GenerationRequest {
	request.Parameters = parameters
	return request
}

func TestQuote3DAndSubmit3DUse3DPaths(t *testing.T) {
	var paths []string
	var bodies []map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		bodies = append(bodies, body)
		if r.URL.Path == "/v1/3d/quotes" {
			// A 3D echo carries n and the model's texture, pbr, face_limit and topology, no resolution.
			json.NewEncoder(w).Encode(map[string]any{"supply": map[string]any{"available": true, "issues": []string{}}, "object": "quote",
				"model": "tripo/tripo-h3.1", "operation": "generate_3d", "input_mode": "text",
				"parameters": map[string]any{"n": 1, "texture": "standard", "pbr": true, "topology": "triangle"},
				"currency":   "USD", "expires_at": 3000000000,
				"primary": map[string]any{"kind": "fixed", "amount": "0.20"}, "official": map[string]any{"kind": "fixed", "amount": "0.20"}})
			return
		}
		if r.Header.Get("Idempotency-Key") != "3d-key" {
			t.Error("idempotency key lost")
		}
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]any{"object": "job", "id": "7201", "status": "queued", "model": "tripo/tripo-h3.1"})
	}))
	defer server.Close()
	for _, catalog := range []*ModelContractCatalog{nil, testModelContracts()} {
		paths, bodies = nil, nil
		client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL, ModelContracts: catalog})
		if err != nil {
			t.Fatal(err)
		}
		quote, err := client.Quote3D(context.Background(), text3DRequest())
		if err != nil || quote.Operation != "generate_3d" || quote.Parameters["texture"] != "standard" {
			t.Fatalf("3d quote: %+v %v", quote, err)
		}
		if _, ok := quote.Parameters["resolution"]; ok {
			t.Fatal("3d echo has resolution")
		}
		job, err := client.Submit3D(context.Background(), SubmitRequest{GenerationRequest: text3DRequest(), WebhookURL: "https://example.com/webhooks/yir"}, "3d-key")
		if err != nil || job.ID != "7201" {
			t.Fatalf("3d submit: %+v %v", job, err)
		}
		if len(paths) != 2 || paths[0] != "/v1/3d/quotes" || paths[1] != "/v1/3d/generations" {
			t.Fatalf("paths: %v", paths)
		}
		if string(bodies[1]["parameters"]) != `{"pbr":true,"texture":"standard"}` {
			t.Fatalf("parameters drift: %s", bodies[1]["parameters"])
		}
	}
}

func TestQuoteBatch3DItemAndGlbFaces(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/quotes" {
			json.NewEncoder(w).Encode(map[string]any{"object": "quote_batch", "request_id": "req_3d", "data": []any{map[string]any{"index": 0,
				"quote": map[string]any{"supply": map[string]any{"available": true, "issues": []string{}}, "object": "quote",
					"model": "tencent/hunyuan-3d-3.1-pro", "operation": "generate_3d", "input_mode": "multiview",
					"parameters": map[string]any{"n": 1, "texture": "standard", "pbr": false, "face_limit": 500000, "topology": "triangle"},
					"currency":   "USD", "expires_at": 3000000000,
					"primary": map[string]any{"kind": "fixed", "amount": "0.525"}, "official": map[string]any{"kind": "fixed", "amount": "0.525"}}}}})
			return
		}
		io.WriteString(w, `{"object":"job","id":"7202","status":"succeeded","model":"tripo/tripo-h3.1","created_at":1,
			"result":{"availability":"available","files":[{"url":"https://cdn.example.com/a.glb","media_type":"model/gltf-binary","faces":48210,"expires_at":2}]}}`)
	}))
	defer server.Close()
	client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL, ModelContracts: testModelContracts()})
	if err != nil {
		t.Fatal(err)
	}
	batch, err := client.QuoteBatch(context.Background(), []QuoteBatchRequestItem{{Operation: "generate_3d",
		Request: multiview3DRequest("hunyuan-3d-3.1-pro", "front_view", "back_view")}})
	if err != nil || batch.Data[0].Quote.Operation != "generate_3d" {
		t.Fatalf("3d batch: %+v %v", batch, err)
	}
	job, err := client.GetJob(context.Background(), "7202")
	if err != nil || job.Result == nil || len(job.Result.Files) != 1 || job.Result.Files[0].Faces != 48210 ||
		job.Result.Files[0].MediaType != "model/gltf-binary" {
		t.Fatalf("3d job: %+v %v", job, err)
	}
}

func Test3DContractRules(t *testing.T) {
	catalog := *testModelContracts()
	for _, request := range []GenerationRequest{
		text3DRequest(),
		with3DParameters(GenerationRequest{Model: "tripo/tripo-h3.1", Input: GenerationInput{Type: "text", Prompt: "A teapot"}},
			map[string]any{"texture": "none", "face_limit": 20000}),
		image3DRequest("microsoft/trellis-2"),
		with3DParameters(image3DRequest("meshy/meshy-7.1"), map[string]any{"texture": "standard", "pbr": true, "face_limit": 300000, "topology": "quad", "n": 1}),
		multiview3DRequest("tencent/hunyuan-3d-3.1-pro", "front_view", "back_view"),
		multiview3DRequest("tencent/hunyuan-3d-3.1-pro", "front_view", "left_view", "back_view", "right_view"),
	} {
		if err := ValidateGenerationProtocol("generate_3d", request); err != nil {
			t.Fatalf("protocol rejected %s %s: %v", request.Model, request.Input.Type, err)
		}
		if err := ValidateGenerationWithCatalog("generate_3d", request, catalog); err != nil {
			t.Fatalf("catalog rejected %s %s: %v", request.Model, request.Input.Type, err)
		}
	}
	for _, tc := range []struct {
		name       string
		request    GenerationRequest
		path, code string
	}{
		{"mode not listed", GenerationRequest{Model: "microsoft/trellis-2", Input: GenerationInput{Type: "text", Prompt: "A chair"}}, "input.type", "operation_contract_unavailable"},
		{"multiview not listed", multiview3DRequest("tripo/tripo-h3.1", "front_view", "back_view"), "input.type", "operation_contract_unavailable"},
		{"image count", image3DRequest("tripo/tripo-h3.1", views3D("reference_image", "reference_image")...), "input.references", "invalid_reference_count"},
		{"image role", image3DRequest("tripo/tripo-h3.1", views3D("front_view")...), "input.references[0].role", "invalid_reference_role"},
		{"texture value", with3DParameters(image3DRequest("tencent/hunyuan-3d-3.1-pro"), map[string]any{"texture": "hd"}), "parameters.texture", "invalid_enum"},
		{"topology value", with3DParameters(image3DRequest("tripo/tripo-h3.1"), map[string]any{"topology": "quad"}), "parameters.topology", "invalid_enum"},
		{"face range", with3DParameters(image3DRequest("tencent/hunyuan-3d-3.1-pro"), map[string]any{"face_limit": 1000}), "parameters.face_limit", "below_minimum"},
		{"face unknown", with3DParameters(image3DRequest("microsoft/trellis-2"), map[string]any{"face_limit": 50000}), "parameters.face_limit", "unknown_parameter"},
		{"pbr fixed", with3DParameters(image3DRequest("microsoft/trellis-2"), map[string]any{"pbr": false}), "parameters.pbr", "invalid_enum"},
		{"n", with3DParameters(image3DRequest("meshy/meshy-7.1"), map[string]any{"n": 2}), "parameters.n", "invalid_enum"},
	} {
		var parameterError *ParameterError
		err := ValidateGenerationWithCatalog("generate_3d", tc.request, catalog)
		if !errors.As(err, &parameterError) || parameterError.Path != tc.path || parameterError.Code != tc.code {
			t.Fatalf("%s: got %v, want %s %s", tc.name, err, tc.path, tc.code)
		}
	}
}

func Test3DProtocolRules(t *testing.T) {
	for _, tc := range []struct {
		name       string
		request    GenerationRequest
		path, code string
	}{
		{"reference mode", GenerationRequest{Model: "tripo-h3.1", Input: GenerationInput{Type: "reference", Prompt: "A chair", References: views3D("front_view")}}, "input.type", "input_mode_invalid"},
		{"image prompt", GenerationRequest{Model: "tripo-h3.1", Input: GenerationInput{Type: "image", Prompt: "A chair", References: views3D("reference_image")}}, "input.prompt", "not_allowed"},
		{"text prompt", GenerationRequest{Model: "tripo-h3.1", Input: GenerationInput{Type: "text", Prompt: " "}}, "input.prompt", "required_parameter"},
		{"no image", image3DRequest("tripo-h3.1", []Reference{}...), "input.references", "invalid_reference_count"},
		{"two images", image3DRequest("tripo-h3.1", views3D("reference_image", "reference_image")...), "input.references", "invalid_reference_count"},
		{"one view", multiview3DRequest("hunyuan-3d-3.1-pro", "front_view"), "input.references", "invalid_reference_count"},
		{"no front", multiview3DRequest("hunyuan-3d-3.1-pro", "back_view", "left_view"), "input.references", "required_reference_role"},
		{"repeated view", multiview3DRequest("hunyuan-3d-3.1-pro", "front_view", "front_view"), "input.references", "invalid_reference_role_count"},
		{"pbr without texture", with3DParameters(text3DRequest(), map[string]any{"texture": "none", "pbr": true}), "parameters.pbr", "parameter_conflict"},
		{"pbr type", with3DParameters(text3DRequest(), map[string]any{"pbr": "yes"}), "parameters.pbr", "invalid_type"},
		{"face type", with3DParameters(text3DRequest(), map[string]any{"face_limit": 1.5}), "parameters.face_limit", "invalid_type"},
		{"texture type", with3DParameters(text3DRequest(), map[string]any{"texture": 1}), "parameters.texture", "invalid_type"},
	} {
		var parameterError *ParameterError
		err := ValidateGenerationProtocol("generate_3d", tc.request)
		if !errors.As(err, &parameterError) || parameterError.Path != tc.path || parameterError.Code != tc.code {
			t.Fatalf("%s: got %v, want %s %s", tc.name, err, tc.path, tc.code)
		}
	}
	// Newer values are left to the Gateway without a catalog.
	if err := ValidateGenerationProtocol("generate_3d", with3DParameters(text3DRequest(), map[string]any{"texture": "ultra", "topology": "hex"})); err != nil {
		t.Fatalf("protocol rejected newer values: %v", err)
	}
}

func TestSubmit3DRetriesWithSameKey(t *testing.T) {
	var keys, bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		keys, bodies = append(keys, r.Header.Get("Idempotency-Key")), append(bodies, string(raw))
		if len(keys) == 1 {
			conn, _, _ := w.(http.Hijacker).Hijack()
			_ = conn.Close()
			return
		}
		w.WriteHeader(http.StatusAccepted)
		io.WriteString(w, `{"object":"job","id":"7203","status":"queued"}`)
	}))
	defer server.Close()
	client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	job, err := client.Submit3D(context.Background(), SubmitRequest{GenerationRequest: image3DRequest("trellis-2")}, "3d-retry")
	if err != nil || job.ID != "7203" || len(keys) != 2 || keys[0] != "3d-retry" || keys[1] != "3d-retry" || bodies[0] != bodies[1] {
		t.Fatalf("3d retry: %+v %v %v", job, err, keys)
	}
	// Image-to-3D sends no prompt text.
	if strings.Contains(bodies[0], `"prompt":"A`) {
		t.Fatalf("image input carried a prompt: %s", bodies[0])
	}
}

func TestDemoModeRefuses3DSubmits(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++ }))
	defer server.Close()
	client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL, Demo: &DemoOptions{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Submit3D(context.Background(), SubmitRequest{GenerationRequest: text3DRequest()}, "3d-demo"); !errors.Is(err, ErrDemoOperationUnsupported) {
		t.Fatalf("demo 3d submit: %v", err)
	}
	if calls != 0 {
		t.Fatalf("demo 3d submit sent %d requests", calls)
	}
}
