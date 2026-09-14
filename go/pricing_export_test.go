package yir

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// Run by pnpm run test:pricing-export with fresh Go API declaration fixtures.
// Ordinary SDK/package tests do not depend on the API module or a checkout.
func TestPriceExportFixtures(t *testing.T) {
	path := os.Getenv("YIR_SDK_PRICE_FIXTURES")
	if path == "" {
		t.Skip("run pnpm run test:pricing-export for cross-module verification")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Table    PriceTable
		Input    PriceInput
		Expected PriceResult
		Request  *GenerationRequest
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures) == 0 {
		t.Fatal("empty exported fixtures")
	}
	for i, f := range fixtures {
		if got := CalculatePrice(f.Table, f.Input); !reflect.DeepEqual(got, f.Expected) {
			t.Fatalf("fixture %d: got %+v, want %+v", i, got, f.Expected)
		}
		if f.Request != nil {
			input, err := BuildPriceInput(f.Input.Operation, *f.Request, f.Table.Version)
			if err != nil {
				t.Fatal(err)
			}
			if got := CalculatePrice(f.Table, input); !reflect.DeepEqual(got, f.Expected) {
				t.Fatalf("request fixture %d: got %+v, want %+v", i, got, f.Expected)
			}
		}
	}
	t.Logf("%d freshly exported Go price fixtures passed", len(fixtures))
}
