package yir

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewerContractRulesKeepKnownChecks(t *testing.T) {
	raw := `{"schema_version":"v1","schema_ref":"fixture","version":"` + strings.Repeat("a", 64) + `","future_root":true,"models":[{"id":"future/image","aliases":[],"locales":{"en":{"label":"F","description":""}},"operations":[{"operation":"generate_image","input_modes":["text","image"],"request_schema":"x",
		"input_constraints":{"text":{"min_references":0,"max_references":0,"allowed_reference_roles":[]},"image":{"min_references":1,"max_references":1,"allowed_reference_roles":["reference_image"],"per_tier_limit":{"pro":4}}},
		"parameters":[{"name":"size","type":"string","required":true,"values":["s"],"control":"color_swatch","locales":{"en":{"label":"S","description":""}},"depends_on":{"quality":"high"}},
			{"name":"mask","type":"region","required":false,"control":"canvas","locales":{"en":{"label":"M","description":""}}},
			{"name":"n","type":"integer","required":false,"values":[1],"control":"number","locales":{"en":{"label":"N","description":""}}}]}]}]}`
	var catalog ModelContractCatalog
	if err := decodeModelContract([]byte(raw), &catalog); err != nil || !validRemoteModelContracts(catalog) {
		t.Fatalf("newer catalog rejected: %v", err)
	}
	// A newer parameter type is left to the Gateway.
	request := GenerationRequest{Model: "future/image", Input: GenerationInput{Type: "text", Prompt: "x"},
		Parameters: map[string]any{"size": "s", "mask": map[string]any{"x": 1}}}
	if err := ValidateGenerationWithCatalog("generate_image", request, catalog); err != nil {
		t.Fatalf("newer parameter type was guessed locally: %v", err)
	}
	// Known rules keep applying beside newer keys.
	request.Parameters["size"] = "other"
	if err := ValidateGenerationWithCatalog("generate_image", request, catalog); err == nil {
		t.Fatal("known enum skipped beside a newer rule key")
	}
	request.Parameters["size"] = "s"
	request.Input = GenerationInput{Type: "image", Prompt: "x", References: []Reference{{Role: "first_frame", FileID: "f1"}}}
	if err := ValidateGenerationWithCatalog("generate_image", request, catalog); err == nil {
		t.Fatal("known reference role rule skipped beside a newer rule key")
	}
	request.Input.References[0].Role = "reference_image"
	if err := ValidateGenerationWithCatalog("generate_image", request, catalog); err != nil {
		t.Fatal(err)
	}
}

func TestExtraRequestFieldsPassThrough(t *testing.T) {
	cost := "0.05"
	request := SubmitRequest{GenerationRequest: GenerationRequest{Model: "future/image", Input: GenerationInput{Type: "text", Prompt: "x"},
		Parameters: map[string]any{"seed": int64(9007199254740993)}, Extra: map[string]any{"future_field": "on", "max_cost": "9"}},
		MaxCost: &cost, WebhookURL: "https://example.com/hook"}
	data, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"future_field": `"on"`, "model": `"future/image"`, "max_cost": `"0.05"`, "webhook_url": `"https://example.com/hook"`} {
		if string(body[key]) != want {
			t.Fatalf("%s = %s, want %s", key, body[key], want)
		}
	}
	if !strings.Contains(string(body["parameters"]), "9007199254740993") {
		t.Fatalf("parameter precision lost: %s", body["parameters"])
	}
	plain, _ := json.Marshal(SubmitRequest{GenerationRequest: GenerationRequest{Model: "m"}, MaxCost: &cost})
	if !strings.Contains(string(plain), `"max_cost":"0.05"`) {
		t.Fatalf("submit fields dropped: %s", plain)
	}
	// Reserved fields never come from Extra, even when the modeled field is empty.
	request.MaxCost = nil
	if data, _ = json.Marshal(request); strings.Contains(string(data), "max_cost") {
		t.Fatalf("Extra injected a reserved field: %s", data)
	}
	request.MaxCost = &cost
	if err := ValidateGenerationProtocol("generate_image", request.GenerationRequest); err == nil || err.Error() != "extra.max_cost: reserved_field" {
		t.Fatalf("reserved Extra key accepted: %v", err)
	}
}

func TestPersistedSubmitRequestRoundTripsExtra(t *testing.T) {
	cost := "0.05"
	saved := SubmitRequest{GenerationRequest: GenerationRequest{Model: "future/image", Input: GenerationInput{Type: "text", Prompt: "x"},
		Parameters: map[string]any{}, Extra: map[string]any{"future_field": map[string]any{"mode": "on"}}}, MaxCost: &cost, WebhookURL: "https://example.com/hook"}
	data, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	var restored SubmitRequest
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	again, _ := json.Marshal(restored)
	if string(again) != string(data) || restored.MaxCost == nil || *restored.MaxCost != cost || restored.WebhookURL != saved.WebhookURL || restored.Model != saved.Model {
		t.Fatalf("round trip changed the request:\n%s\n%s", data, again)
	}
}

func TestNewerJobStatusKeepsAcceptedJob(t *testing.T) {
	var statusCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/images/generations":
			io.WriteString(w, `{"id":"7","status":"pending_review"}`)
		case "/v1/jobs/7/status":
			if statusCalls.Add(1) < 3 {
				io.WriteString(w, `{"id":"7","status":"pending_review","error":null}`)
			} else {
				io.WriteString(w, `{"id":"7","status":"succeeded","error":null}`)
			}
		case "/v1/jobs/7":
			io.WriteString(w, `{"id":"7","status":"succeeded"}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	// A status newer than this SDK must not hide the ID of a Job the Gateway accepted.
	job, err := client.SubmitImage(context.Background(), SubmitRequest{GenerationRequest: imageRequest()}, "key")
	if err != nil || job.ID != "7" || job.Status != "pending_review" || job.IsTerminal() {
		t.Fatalf("job=%+v err=%v", job, err)
	}
	var polled []string
	job, err = client.WaitJob(context.Background(), "7", WaitOptions{PollInterval: time.Millisecond,
		OnPoll: func(s JobStatusResponse) { polled = append(polled, s.Status) }})
	if err != nil || job.Status != "succeeded" || strings.Join(polled, ",") != "pending_review,pending_review,succeeded" {
		t.Fatalf("job=%+v err=%v polled=%v", job, err, polled)
	}
}

func TestNewerFileStatusWaitsForReady(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := "scanning"
		if calls.Add(1) >= 3 {
			status = "ready"
		}
		json.NewEncoder(w).Encode(File{ID: testFileID, Object: "file", Status: status, Name: "a.png", MediaType: "image/png", Size: 100})
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	// A status newer than this SDK is still being prepared, not a broken response.
	file, err := client.GetFile(context.Background(), testFileID)
	if err != nil || file.Status != "scanning" {
		t.Fatalf("file=%+v err=%v", file, err)
	}
	ready, err := client.UploadFile(context.Background(), file, nil)
	if err != nil || ready.Status != "ready" || calls.Load() != 3 {
		t.Fatalf("file=%+v err=%v calls=%d", ready, err, calls.Load())
	}
}

func TestEmptyFileStatusIsInvalid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"id":"`+testFileID+`","object":"file","status":" "}`)
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if _, err := client.GetFile(context.Background(), testFileID); err == nil || err.Error() != "response_invalid" {
		t.Fatalf("err=%v", err)
	}
}
