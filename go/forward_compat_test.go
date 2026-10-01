package yir

import (
	"encoding/json"
	"strings"
	"testing"
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
