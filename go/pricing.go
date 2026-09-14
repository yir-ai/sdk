package yir

import (
	"encoding/json"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// PriceTable is a customer-supplied immutable price snapshot, not execution authority.
type PriceTable struct {
	Format  string     `json:"format"`
	Version string     `json:"version"`
	Purpose string     `json:"purpose"`
	Unit    string     `json:"unit"`
	Scale   int64      `json:"scale"`
	Rows    []PriceRow `json:"rows"`
}
type PriceRow struct {
	ID          string           `json:"id"`
	Model       string           `json:"model"`
	Operation   string           `json:"operation"`
	Conditions  map[string][]any `json:"conditions"`
	Kind        string           `json:"kind"`
	Description string           `json:"description,omitempty"`
	Price       TablePrice       `json:"price"`
}
type TablePrice struct {
	Type     string `json:"type"`
	Amount   string `json:"amount"`
	Quantity string `json:"quantity,omitempty"`
	Per      string `json:"per,omitempty"`
	Rounding string `json:"rounding,omitempty"`
}
type PriceInput struct {
	Model      string         `json:"model"`
	Operation  string         `json:"operation"`
	Parameters map[string]any `json:"parameters"`
	Version    string         `json:"version"`
}
type PriceResult struct {
	Kind        string `json:"kind"`
	Reason      string `json:"reason,omitempty"`
	Amount      string `json:"amount,omitempty"`
	RowID       string `json:"rowId,omitempty"`
	Version     string `json:"version,omitempty"`
	Purpose     string `json:"purpose,omitempty"`
	Unit        string `json:"unit,omitempty"`
	Scale       int64  `json:"scale,omitempty"`
	Description string `json:"description,omitempty"`
}

const maxPriceParameter = int64(9007199254740991)

var priceIntegerPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,18})$`)

func priceInteger(s string) (int64, bool) {
	if !priceIntegerPattern.MatchString(s) {
		return 0, false
	}
	n, err := strconv.ParseInt(s, 10, 64)
	return n, err == nil
}
func priceText(s string) bool { return strings.TrimSpace(s) != "" }

// JSON numbers and native Go integers share JS safe-integer parameter semantics.
func priceNumber(v any) (int64, bool) {
	var n int64
	switch x := v.(type) {
	case int:
		n = int64(x)
	case int64:
		n = x
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) || math.Trunc(x) != x || math.Abs(x) > float64(maxPriceParameter) {
			return 0, false
		}
		n = int64(x)
	case json.Number:
		f, err := strconv.ParseFloat(string(x), 64)
		if err != nil {
			return 0, false
		}
		return priceNumber(f)
	default:
		return 0, false
	}
	return n, n >= -maxPriceParameter && n <= maxPriceParameter
}
func priceScalar(v any) bool {
	switch v.(type) {
	case string, bool:
		return true
	}
	_, ok := priceNumber(v)
	return ok
}
func samePriceValue(a, b any) bool {
	switch x := a.(type) {
	case string:
		y, ok := b.(string)
		return ok && x == y
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	}
	x, ok := priceNumber(a)
	y, valid := priceNumber(b)
	return ok && valid && x == y
}

func (t PriceTable) Valid() bool {
	if t.Format != "yir-price-table-v1" || !priceText(t.Version) || (t.Purpose != "retail" && t.Purpose != "yir-cost") || !priceText(t.Unit) || t.Scale <= 0 || t.Scale > maxPriceParameter || t.Rows == nil {
		return false
	}
	ids := map[string]bool{}
	for _, r := range t.Rows {
		if !priceText(r.ID) || ids[r.ID] || !priceText(r.Model) || !priceText(r.Operation) || r.Conditions == nil || (r.Kind != "exact" && r.Kind != "estimate") || (r.Description != "" && !priceText(r.Description)) || (r.Kind == "estimate" && !priceText(r.Description)) {
			return false
		}
		ids[r.ID] = true
		if _, ok := priceInteger(r.Price.Amount); !ok {
			return false
		}
		for key, values := range r.Conditions {
			if !priceText(key) || len(values) == 0 {
				return false
			}
			for i, value := range values {
				if !priceScalar(value) {
					return false
				}
				for _, previous := range values[:i] {
					if samePriceValue(previous, value) {
						return false
					}
				}
			}
		}
		switch r.Price.Type {
		case "total":
		case "unit":
			per, ok := priceInteger(r.Price.Per)
			if !priceText(r.Price.Quantity) || !ok || per == 0 || (r.Price.Rounding != "ceil" && r.Price.Rounding != "floor" && r.Price.Rounding != "half-up") {
				return false
			}
			values := r.Conditions[r.Price.Quantity]
			if len(values) == 0 {
				return false
			}
			for _, value := range values {
				n, ok := priceNumber(value)
				if !ok || n < 0 {
					return false
				}
			}
		default:
			return false
		}
	}
	return true
}

// CalculatePrice performs no I/O, defaulting, currency conversion, or credit deductions.
// The caller must provide normalized pricing dimensions and a trusted table version.
func CalculatePrice(table PriceTable, input PriceInput) PriceResult {
	unavailable := func(reason string) PriceResult { return PriceResult{Kind: "unavailable", Reason: reason} }
	if !table.Valid() {
		return unavailable("invalid_table")
	}
	if !priceText(input.Model) || !priceText(input.Operation) || !priceText(input.Version) || input.Parameters == nil {
		return unavailable("invalid_input")
	}
	for _, value := range input.Parameters {
		if !priceScalar(value) {
			return unavailable("invalid_input")
		}
	}
	if input.Version != table.Version {
		return unavailable("version_mismatch")
	}
	var matched *PriceRow
	for i := range table.Rows {
		row := &table.Rows[i]
		if row.Model != input.Model || row.Operation != input.Operation || len(row.Conditions) != len(input.Parameters) {
			continue
		}
		matches := true
		for key, values := range row.Conditions {
			value, exists := input.Parameters[key]
			found := false
			for _, allowed := range values {
				if exists && samePriceValue(value, allowed) {
					found = true
					break
				}
			}
			if !found {
				matches = false
				break
			}
		}
		if matches {
			if matched != nil {
				return unavailable("ambiguous_match")
			}
			matched = row
		}
	}
	if matched == nil {
		return unavailable("no_match")
	}
	amount, _ := priceInteger(matched.Price.Amount)
	if matched.Price.Type == "unit" {
		quantity, _ := priceNumber(input.Parameters[matched.Price.Quantity])
		numerator := new(big.Int).Mul(big.NewInt(amount), big.NewInt(quantity))
		if !numerator.IsInt64() {
			return unavailable("overflow")
		}
		per, _ := priceInteger(matched.Price.Per)
		quotient, remainder := new(big.Int), new(big.Int)
		quotient.QuoRem(numerator, big.NewInt(per), remainder)
		if (matched.Price.Rounding == "ceil" && remainder.Sign() > 0) || (matched.Price.Rounding == "half-up" && new(big.Int).Lsh(remainder, 1).Cmp(big.NewInt(per)) >= 0) {
			quotient.Add(quotient, big.NewInt(1))
		}
		amount = quotient.Int64()
	}
	return PriceResult{Kind: matched.Kind, Amount: strconv.FormatInt(amount, 10), RowID: matched.ID, Version: table.Version, Purpose: table.Purpose, Unit: table.Unit, Scale: table.Scale, Description: matched.Description}
}
