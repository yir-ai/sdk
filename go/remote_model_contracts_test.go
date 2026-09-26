package yir

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientReadsVersionedModelContractsWithoutBundledAdmission(t *testing.T) {
	model := cloneStaticModelContract(bundledModelContractCatalog.Models[0])
	model.ID = "future/new-image"
	model.Aliases = nil
	catalog := ModelContractCatalog{
		SchemaVersion: "v1", SchemaRef: bundledModelContractCatalog.SchemaRef,
		Version: strings.Repeat("a", 64), Models: []StaticModelContract{model},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing bearer")
		}
		switch r.URL.RequestURI() {
		case "/v1/models?include=parameters":
			json.NewEncoder(w).Encode(catalog)
		case "/v1/models/future/new-image?view=contract":
			json.NewEncoder(w).Encode(ModelContractDetail{
				SchemaVersion: catalog.SchemaVersion, SchemaRef: catalog.SchemaRef,
				Version: catalog.Version, Model: model,
			})
		default:
			t.Errorf("unexpected path: %s", r.URL.RequestURI())
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	list, err := client.GetModelContracts(context.Background())
	if err != nil || list.Version != catalog.Version || len(list.Models) != 1 || list.Models[0].ID != model.ID {
		t.Fatalf("list: %+v, %v", list, err)
	}
	detail, err := client.GetModelContract(context.Background(), model.ID)
	if err != nil || detail.Version != catalog.Version || detail.Model.ID != model.ID {
		t.Fatalf("detail: %+v, %v", detail, err)
	}
	if _, err := client.GetModelContract(context.Background(), "future/new-image?view=pricing"); err == nil {
		t.Fatal("unsafe model path accepted")
	}
}

func TestRemoteModelContractRejectsUnknownSemantics(t *testing.T) {
	model := cloneStaticModelContract(bundledModelContractCatalog.Models[0])
	catalog := ModelContractCatalog{
		SchemaVersion: "v1", SchemaRef: bundledModelContractCatalog.SchemaRef,
		Version: strings.Repeat("a", 64), Models: []StaticModelContract{model},
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal(encoded, &root); err != nil {
		t.Fatal(err)
	}
	models := root["models"].([]any)
	operations := models[0].(map[string]any)["operations"].([]any)
	constraints := operations[0].(map[string]any)["input_constraints"].(map[string]any)
	for _, value := range constraints {
		value.(map[string]any)["new_requirement"] = true
		break
	}
	changed, _ := json.Marshal(root)
	var result ModelContractCatalog
	if err := decodeModelContract(changed, &result); err == nil {
		t.Fatal("unknown necessary rule ignored")
	}
}

func TestClientFutureModelDoesNotNeedBundledRegistry(t *testing.T) {
	const futureModel = "future/new-image"
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/images/quotes" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"object":"quote","model":"future/new-image","operation":"generate_image","input_mode":"text","parameters":{},"currency":"USD","expires_at":3000000000,"has_verifiable_upper_bound":true,"single_attempt_upper_bound":"0.05","primary":{"kind":"fixed","amount":"0.02"},"max":{"kind":"fixed","amount":"0.05"},"official":{"kind":"unavailable","amount":null,"reason":"official_price_unavailable"}}`))
	}))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	request := GenerationRequest{Model: futureModel, Input: GenerationInput{Type: "text", Prompt: "observatory"}, Parameters: map[string]any{"future_option": "new"}}
	quote, err := client.QuoteImage(context.Background(), request)
	if err != nil || quote.Model != futureModel || calls != 1 {
		t.Fatalf("quote: %+v, %v, calls=%d", quote, err, calls)
	}
}

func TestClientQuoteAcceptsPublishedAliasWithExternalContract(t *testing.T) {
	model, ok := GetModelContract("openai/gpt-image-2")
	if !ok {
		t.Fatal("missing test contract")
	}
	model.ID = "future/new-image"
	model.Aliases = []string{"new-image"}
	catalog := ModelContractCatalog{SchemaVersion: "v1", SchemaRef: bundledModelContractCatalog.SchemaRef,
		Version: strings.Repeat("a", 64), Models: []StaticModelContract{model}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"object":"quote","model":"new-image","operation":"generate_image","input_mode":"text","parameters":{},"currency":"USD","expires_at":3000000000,"has_verifiable_upper_bound":true,"single_attempt_upper_bound":"0.05","primary":{"kind":"fixed","amount":"0.02"},"max":{"kind":"fixed","amount":"0.05"},"official":{"kind":"unavailable","amount":null,"reason":"official_price_unavailable"}}`))
	}))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL, ModelContracts: &catalog})
	if err != nil {
		t.Fatal(err)
	}
	quote, err := client.QuoteImage(context.Background(), GenerationRequest{Model: "new-image", Input: GenerationInput{Type: "text", Prompt: "observatory"}})
	if err != nil || quote.Model != "new-image" {
		t.Fatalf("alias quote: %+v, %v", quote, err)
	}
}
