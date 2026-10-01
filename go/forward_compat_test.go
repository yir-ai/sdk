package yir

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNewerContractRulesDeferToGateway(t *testing.T) {
	raw := `{"schema_version":"v1","schema_ref":"fixture","version":"` + strings.Repeat("a", 64) + `","future_root":true,"models":[{"id":"future/image","aliases":[],"locales":{"en":{"label":"F","description":""}},"operations":[{"operation":"generate_image","input_modes":["text","image"],"request_schema":"x",
		"input_constraints":{"text":{"min_references":0,"max_references":0,"allowed_reference_roles":[]},"image":{"min_references":1,"max_references":1,"allowed_reference_roles":["reference_image"],"per_tier_limit":{"pro":4}}},
		"parameters":[{"name":"size","type":"string","required":true,"values":["s"],"control":"color_swatch","locales":{"en":{"label":"S","description":""}},"depends_on":{"quality":"high"}},
			{"name":"mask","type":"region","required":false,"control":"canvas","locales":{"en":{"label":"M","description":""}}},
			{"name":"n","type":"integer","required":false,"values":[1],"control":"number","locales":{"en":{"label":"N","description":""}}}]}]}]}`
	var catalog ModelContractCatalog
	if err := decodeModelContract([]byte(raw), &catalog); err != nil || !validRemoteModelContracts(catalog) {
		t.Fatalf("newer catalog rejected: %v", err)
	}
	request := GenerationRequest{Model: "future/image", Input: GenerationInput{Type: "text", Prompt: "x"},
		Parameters: map[string]any{"size": "other", "mask": map[string]any{"x": 1}}}
	if err := ValidateGenerationWithCatalog("generate_image", request, catalog); err != nil {
		t.Fatalf("unknown parameter rules were guessed locally: %v", err)
	}
	request.Parameters["n"] = 2
	if err := ValidateGenerationWithCatalog("generate_image", request, catalog); err == nil {
		t.Fatal("known parameter rule skipped")
	}
	delete(request.Parameters, "n")
	request.Input = GenerationInput{Type: "image", Prompt: "x", References: []Reference{{Role: "first_frame", FileID: "f1"}, {Role: "first_frame", FileID: "f2"}}}
	if err := ValidateGenerationWithCatalog("generate_image", request, catalog); err != nil {
		t.Fatalf("unknown reference rules were guessed locally: %v", err)
	}
}

func TestExtraRequestFieldsPassThrough(t *testing.T) {
	cost := "0.05"
	request := SubmitRequest{GenerationRequest: GenerationRequest{Model: "future/image", Input: GenerationInput{Type: "text", Prompt: "x"},
		Parameters: map[string]any{"seed": int64(9007199254740993)}, Extra: map[string]any{"future_field": "on", "model": "ignored"}},
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
}
