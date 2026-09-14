package yir

import (
	"encoding/json"
	"os"
	"strconv"
	"testing"
)

// Fresh production service output and customer retail snapshot from the Node
// runner. The backend loads its own published table, never a browser table.
func TestPricingCheckoutFixtures(t *testing.T) {
	filename := os.Getenv("YIR_SDK_CHECKOUT_FIXTURES")
	if filename == "" {
		t.Skip("run pnpm run test:pricing-checkout")
	}
	raw, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Response ModelPrices
		Retail   PriceTable
		Cases    []struct {
			Request      GenerationRequest
			Primary      string
			Max          string
			RetailAmount string
		}
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if err := fixture.Response.Validate("klingai/kling-2.6", "generate_video", "text"); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("empty cases")
	}
	for _, c := range fixture.Cases {
		for _, pair := range []struct {
			table  PriceTable
			amount string
		}{
			{fixture.Response.Prices.Primary, c.Primary},
			{fixture.Response.Prices.Max, c.Max},
			{fixture.Retail, c.RetailAmount},
		} {
			input, err := BuildPriceInput("generate_video", c.Request, pair.table.Version)
			if err != nil {
				t.Fatal(err)
			}
			got := CalculatePrice(pair.table, input)
			if got.Kind != "exact" || got.Amount != pair.amount {
				t.Fatalf("got %+v, want %s", got, pair.amount)
			}
			// Copy the slice before mutation: all following checks must still consume
			// the original published snapshot, including its row IDs and totals.
			for index, row := range pair.table.Rows {
				if row.ID != got.RowID {
					continue
				}
				missing := pair.table
				missing.Rows = append([]PriceRow{}, pair.table.Rows[:index]...)
				missing.Rows = append(missing.Rows, pair.table.Rows[index+1:]...)
				if result := CalculatePrice(missing, input); result.Reason != "no_match" {
					t.Fatal(result)
				}
				overlap := pair.table
				overlap.Rows = append([]PriceRow{}, pair.table.Rows...)
				duplicate := row
				duplicate.ID += "-overlap"
				overlap.Rows = append(overlap.Rows, duplicate)
				if result := CalculatePrice(overlap, input); result.Reason != "ambiguous_match" {
					t.Fatal(result)
				}
				wrong := pair.table
				wrong.Rows = append([]PriceRow{}, pair.table.Rows...)
				amount, err := strconv.ParseInt(row.Price.Amount, 10, 64)
				if err != nil {
					t.Fatal(err)
				}
				wrong.Rows[index].Price.Amount = strconv.FormatInt(amount+1, 10)
				if result := CalculatePrice(wrong, input); result.Amount == pair.amount {
					t.Fatal("incorrect total was not detected")
				}
			}
		}
	}
	input, err := BuildPriceInput("generate_video", fixture.Cases[0].Request, fixture.Retail.Version)
	if err != nil {
		t.Fatal(err)
	}
	unsupported := fixture.Cases[0].Request
	unsupported.Parameters = map[string]any{}
	for key, value := range fixture.Cases[0].Request.Parameters {
		unsupported.Parameters[key] = value
	}
	unsupported.Parameters["generate_audio"] = true
	if _, err := BuildPriceInput("generate_video", unsupported, fixture.Retail.Version); err == nil {
		t.Fatal("unsupported audio accepted")
	}
	// Customer may keep the accepted old snapshot alongside a new publication.
	published := map[string]PriceTable{fixture.Retail.Version: fixture.Retail}
	next := fixture.Retail
	next.Version = "retail-v2"
	published[next.Version] = next
	if got := CalculatePrice(published[input.Version], input); got.Kind != "exact" {
		t.Fatal(got)
	}
	if got := CalculatePrice(next, input); got.Reason != "version_mismatch" {
		t.Fatal(got)
	}
	delete(published, input.Version)
	if _, accepted := published[input.Version]; accepted {
		t.Fatal("expired version accepted")
	}
	missing := fixture.Retail
	missing.Rows = []PriceRow{}
	if got := CalculatePrice(missing, input); got.Reason != "no_match" {
		t.Fatal(got)
	}
}
