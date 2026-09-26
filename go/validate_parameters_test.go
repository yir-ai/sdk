package yir

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestValidateDynamicParameters(t *testing.T) {
	min, max := 1.0, 4.0
	rules := []ModelParameterContract{
		{Name: "n", Type: "integer", Required: true, Minimum: &min, Maximum: &max},
		{Name: "quality", Type: "string", Default: "high", Values: []any{"high", "low"}},
	}
	for _, tc := range []struct {
		name   string
		params map[string]any
		code   string
	}{
		{"json integer", map[string]any{"n": json.Number("2.0")}, ""},
		{"Go integer", map[string]any{"n": 2}, ""},
		{"missing", nil, "required_parameter"},
		{"fraction", map[string]any{"n": 1.5}, "invalid_type"},
		{"numeric string", map[string]any{"n": "2"}, "invalid_type"},
		{"null", map[string]any{"n": nil}, "invalid_type"},
		{"range", map[string]any{"n": 5}, "above_maximum"},
		{"large exact number", map[string]any{"n": json.Number("9007199254740993")}, "above_maximum"},
		{"enum", map[string]any{"n": 1, "quality": "secret-value"}, "invalid_enum"},
		{"unknown", map[string]any{"n": 1, "provider_key": "secret-value"}, "unknown_parameter"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateParameters(rules, tc.params)
			if tc.code == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var field *ParameterError
			if !errors.As(err, &field) || field.Code != tc.code {
				t.Fatalf("got %v, want %s", err, tc.code)
			}
		})
	}
}

func TestValidateUnknownModelLocally(t *testing.T) {
	err := ValidateModelParameters("unknown/model", "generate_image", "text", nil)
	var field *ParameterError
	if !errors.As(err, &field) || field.Code != "model_contract_unavailable" {
		t.Fatalf("got %v", err)
	}
}
