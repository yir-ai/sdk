package yir_test

import (
	"fmt"
	yir "github.com/sungerine/yir-sdk/go"
)

func ExampleCalculatePrice() {
	table := yir.PriceTable{Format: "yir-price-table-v1", Version: "retail-v1", Purpose: "retail", Unit: "credit", Scale: 100,
		Rows: []yir.PriceRow{{ID: "video-5s", Model: "demo/video", Operation: "generate_video", Kind: "exact",
			Conditions: map[string][]any{"duration": {5}, "audio": {false}}, Price: yir.TablePrice{Type: "total", Amount: "2000"}}}}
	result := yir.CalculatePrice(table, yir.PriceInput{Model: "demo/video", Operation: "generate_video", Version: "retail-v1", Parameters: map[string]any{"duration": 5, "audio": false}})
	fmt.Println(result.Kind, result.Amount, result.Unit, result.Scale)
	// Output: exact 2000 credit 100
}
