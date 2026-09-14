package yir

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
)

// ParameterError identifies a local contract violation without echoing input values.
type ParameterError struct {
	Path string
	Code string
}

func (e *ParameterError) Error() string { return fmt.Sprintf("%s: %s", e.Path, e.Code) }

// ValidateModelParameters validates only the parameters against bundled rules.
// Media and cross-parameter validation belong to complete request validation.
// Defaults satisfy omitted parameters but this function never mutates the input.
func ValidateModelParameters(model, operation, inputMode string, parameters map[string]any) error {
	contract, ok := GetModelOperationContract(model, operation, inputMode)
	if !ok {
		return &ParameterError{Path: "model", Code: "model_contract_unavailable"}
	}
	return validateParameters(contract.Parameters, parameters)
}

func validateParameters(rules []ModelParameterContract, parameters map[string]any) error {
	known := make(map[string]bool, len(rules))
	for _, rule := range rules {
		known[rule.Name] = true
	}
	keys := make([]string, 0, len(parameters))
	for key := range parameters {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !known[key] {
			return &ParameterError{"parameters." + key, "unknown_parameter"}
		}
	}
	for _, rule := range rules {
		path := "parameters." + rule.Name
		value, exists := parameters[rule.Name]
		if !exists {
			if rule.Default != nil {
				value = rule.Default
			} else if rule.Required {
				return &ParameterError{path, "required_parameter"}
			} else {
				continue
			}
		}
		normalized, err := normalizeParameter(value)
		if err != nil {
			return &ParameterError{path, "invalid_type"}
		}
		switch rule.Type {
		case "string":
			if _, ok := normalized.(string); !ok {
				return &ParameterError{path, "invalid_type"}
			}
		case "boolean":
			if _, ok := normalized.(bool); !ok {
				return &ParameterError{path, "invalid_type"}
			}
		case "integer":
			number, ok := parameterInteger(normalized)
			if !ok {
				return &ParameterError{path, "invalid_type"}
			}
			if rule.Minimum != nil && number.Cmp(big.NewInt(int64(*rule.Minimum))) < 0 {
				return &ParameterError{path, "below_minimum"}
			}
			if rule.Maximum != nil && number.Cmp(big.NewInt(int64(*rule.Maximum))) > 0 {
				return &ParameterError{path, "above_maximum"}
			}
		default:
			return &ParameterError{path, "unsupported_contract_type"}
		}
		if len(rule.Values) > 0 {
			matched := false
			for _, allowed := range rule.Values {
				candidate, err := normalizeParameter(allowed)
				if err != nil {
					continue
				}
				if rule.Type == "integer" {
					a, aOK := parameterInteger(normalized)
					b, bOK := parameterInteger(candidate)
					matched = aOK && bOK && a.Cmp(b) == 0
				} else {
					matched = normalized == candidate
				}
				if matched {
					break
				}
			}
			if !matched {
				return &ParameterError{path, "invalid_enum"}
			}
		}
	}
	return nil
}

func normalizeParameter(value any) (any, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var result any
	err = decoder.Decode(&result)
	return result, err
}

func parameterInteger(value any) (*big.Int, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return nil, false
	}
	rational, ok := new(big.Rat).SetString(string(number))
	if !ok || !rational.IsInt() {
		return nil, false
	}
	return rational.Num(), true
}
