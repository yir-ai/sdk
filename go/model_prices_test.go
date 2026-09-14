package yir

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestModelPriceInputs(t *testing.T) {
	raw, err := os.ReadFile("testdata/model-price-input-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name      string
		Operation string
		Request   GenerationRequest
		Expected  PriceInput
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			got, err := BuildPriceInput(f.Operation, f.Request, "fixture-v1")
			if err != nil {
				t.Fatal(err)
			}
			a, _ := json.Marshal(got)
			b, _ := json.Marshal(f.Expected)
			if string(a) != string(b) {
				t.Fatalf("got %s; want %s", a, b)
			}
		})
	}
}

func TestGetModelPrices(t *testing.T) {
	table := PriceTable{Format: "yir-price-table-v1", Version: "v1", Purpose: "yir-cost", Unit: "USD", Scale: 1000000, Rows: []PriceRow{}}
	response := ModelPrices{ID: "klingai/kling-2.6", Object: "model_prices", Operation: "generate_video", InputMode: "text", ContractVersion: "c1", Coverage: "enumerated", Issues: []string{}, Prices: ModelPriceTables{Primary: table, Max: table, ExpiresAt: 2000000000, Unavailable: []ModelPriceUnavailable{}}}
	for _, expiry := range []int64{0, -1, maxPriceParameter + 1} {
		invalid := response
		invalid.Prices.ExpiresAt = expiry
		if err := invalid.Validate(response.ID, response.Operation, response.InputMode); err == nil {
			t.Fatalf("accepted invalid expiry %d", expiry)
		}
	}
	calls := 0
	query := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.RequestURI() != "/v1/models/klingai/kling-2.6?view=pricing&operation=generate_video&input_mode=text"+query || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("wrong request")
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.GetModelPrices(context.Background(), response.ID, response.Operation, response.InputMode); err != nil {
		t.Fatal(err)
	}
	if _, err = client.GetModelPrices(context.Background(), "../private", response.Operation, response.InputMode); err == nil || calls != 1 {
		t.Fatal("invalid path reached server")
	}
	query = "&resolution=720p"
	response.Filter = &ModelPriceFilter{Resolution: "720p"}
	if _, err = client.GetModelPrices(context.Background(), response.ID, response.Operation, response.InputMode, ModelPriceFilter{Resolution: "720P"}); err != nil {
		t.Fatal(err)
	}
	response.Filter.Resolution = "1080p"
	if _, err = client.GetModelPrices(context.Background(), response.ID, response.Operation, response.InputMode, ModelPriceFilter{Resolution: "720p"}); err == nil {
		t.Fatal("accepted wrong filter")
	}
	count := 1
	before := calls
	if _, err = client.GetModelPrices(context.Background(), response.ID, response.Operation, response.InputMode, ModelPriceFilter{ReferenceCount: &count}); err == nil || calls != before {
		t.Fatal("invalid count reached server")
	}
	query = ""
	response.Filter = nil
	response.Prices.Primary.Purpose = "retail"
	if _, err = client.GetModelPrices(context.Background(), response.ID, response.Operation, response.InputMode); err == nil {
		t.Fatal("accepted retail data as cost")
	}
}

func TestModelPriceFilterScope(t *testing.T) {
	count := 2
	filter := ModelPriceFilter{Resolution: "2k", ReferenceCount: &count}
	conditions := map[string][]any{"input_mode": {"image"}, "resolution": {"2k"}}
	for _, role := range []string{"source_image", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"} {
		conditions[role+"_count"] = []any{0}
	}
	conditions["reference_image_count"] = []any{2}
	row := PriceRow{ID: "scope", Model: "bytedance/seedream-5.0-pro", Operation: "generate_image", Conditions: conditions, Kind: "exact", Price: TablePrice{Type: "total", Amount: "1"}}
	table := PriceTable{Format: "yir-price-table-v1", Version: "v1", Purpose: "yir-cost", Unit: "USD", Scale: 1000000, Rows: []PriceRow{row}}
	response := ModelPrices{ID: row.Model, Object: "model_prices", Operation: row.Operation, InputMode: "image", ContractVersion: "c1", Coverage: "enumerated", Issues: []string{}, Filter: &filter, Prices: ModelPriceTables{Primary: table, Max: table, ExpiresAt: 2000000000, Unavailable: []ModelPriceUnavailable{}}}
	if err := response.Validate(row.Model, row.Operation, "image", filter); err != nil {
		t.Fatal(err)
	}
	if err := response.Validate(row.Model, row.Operation, "image"); err == nil {
		t.Fatal("filtered result accepted as complete model")
	}
	conditions["reference_image_count"] = []any{1}
	if err := response.Validate(row.Model, row.Operation, "image", filter); err == nil {
		t.Fatal("wrong row scope accepted")
	}
}
