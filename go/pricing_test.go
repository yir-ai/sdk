package yir

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestPriceTableSharedFixtures(t *testing.T) {
	data, err := os.ReadFile("testdata/price-table-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name     string      `json:"name"`
		Table    PriceTable  `json:"table"`
		Input    PriceInput  `json:"input"`
		Expected PriceResult `json:"expected"`
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			before, _ := json.Marshal(f)
			if got := CalculatePrice(f.Table, f.Input); !reflect.DeepEqual(got, f.Expected) {
				t.Fatalf("got %+v; want %+v", got, f.Expected)
			}
			after, _ := json.Marshal(f)
			if string(before) != string(after) {
				t.Fatal("calculation modified inputs")
			}
		})
	}
}

func TestPriceNativeParameters(t *testing.T) {
	table := PriceTable{Format: "yir-price-table-v1", Version: "v1", Purpose: "retail", Unit: "credit", Scale: 100,
		Rows: []PriceRow{{ID: "one", Model: "custom", Operation: "generate_image", Kind: "exact",
			Conditions: map[string][]any{"n": {1, int64(2), json.Number("3")}}, Price: TablePrice{Type: "unit", Amount: "150", Quantity: "n", Per: "1", Rounding: "ceil"}}}}
	for _, n := range []any{1, int64(1), float64(1), json.Number("1")} {
		result := CalculatePrice(table, PriceInput{Model: "custom", Operation: "generate_image", Version: "v1", Parameters: map[string]any{"n": n}})
		if result.Kind != "exact" || result.Amount != "150" {
			t.Fatalf("native input %T: %+v", n, result)
		}
	}
}
