package yir

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

type ModelPriceFilter struct {
	Resolution     string `json:"resolution,omitempty"`
	ReferenceCount *int   `json:"reference_count,omitempty"`
}

var modelPriceResolutionPattern = regexp.MustCompile(`^[a-zA-Z0-9.]{1,32}$`)

func (f ModelPriceFilter) valid(mode string) bool {
	return (f.Resolution == "" || modelPriceResolutionPattern.MatchString(f.Resolution)) && (f.ReferenceCount == nil || (mode == "image" && *f.ReferenceCount >= 1 && *f.ReferenceCount <= 512))
}

func (f ModelPriceFilter) matches(conditions map[string][]any) bool {
	if f.Resolution != "" && (len(conditions["resolution"]) != 1 || conditions["resolution"][0] != strings.ToLower(f.Resolution)) {
		return false
	}
	if f.ReferenceCount != nil {
		count := int64(0)
		for _, role := range []string{"source_image", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"} {
			values := conditions[role+"_count"]
			if len(values) != 1 {
				return false
			}
			n, ok := priceNumber(values[0])
			if !ok || n < 0 || n > 512 {
				return false
			}
			count += n
		}
		if count != int64(*f.ReferenceCount) {
			return false
		}
	}
	return true
}

type ModelPrices struct {
	ChannelParameters []ChannelParameters `json:"channel_parameters,omitempty"`
	ID                string              `json:"id"`
	Object            string              `json:"object"`
	Operation         string              `json:"operation"`
	InputMode         string              `json:"input_mode"`
	ContractVersion   string              `json:"contract_version"`
	Coverage          string              `json:"coverage"`
	Issues            []string            `json:"issues"`
	Filter            *ModelPriceFilter   `json:"filter,omitempty"`
	Prices            ModelPriceTables    `json:"prices"`
}

type ModelPriceTables struct {
	Primary     PriceTable              `json:"primary"`
	Max         PriceTable              `json:"max"`
	ExpiresAt   int64                   `json:"expires_at"`
	Unavailable []ModelPriceUnavailable `json:"unavailable"`
}

type ModelPriceUnavailable struct {
	ID         string           `json:"id"`
	Model      string           `json:"model"`
	Operation  string           `json:"operation"`
	Conditions map[string][]any `json:"conditions"`
	Basis      string           `json:"basis"`
	Reason     string           `json:"reason"`
}

var modelPriceSegmentPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$`)

// GetModelPrices makes one scoped read. Applications own refresh, policy-isolated
// caching and retail conversion; request overrides require request-level Quote.
func (c *Client) GetModelPrices(ctx context.Context, model, operation, inputMode string, filters ...ModelPriceFilter) (ModelPrices, error) {
	if len(filters) > 1 {
		return ModelPrices{}, errors.New("model_prices_request_invalid")
	}
	filter := ModelPriceFilter{}
	if len(filters) == 1 {
		filter = filters[0]
	}
	if !filter.valid(inputMode) {
		return ModelPrices{}, errors.New("model_prices_request_invalid")
	}
	filter.Resolution = strings.ToLower(filter.Resolution)
	query := ""
	if filter.Resolution != "" {
		query += "&resolution=" + filter.Resolution
	}
	if filter.ReferenceCount != nil {
		query += "&reference_count=" + strconv.Itoa(*filter.ReferenceCount)
	}
	if contract, ok := GetModelContract(model); ok {
		model = contract.ID
	}
	parts := strings.Split(model, "/")
	if len(parts) != 2 || len(parts[0]) > 100 || len(parts[1]) > 100 || !modelPriceSegmentPattern.MatchString(parts[0]) || !modelPriceSegmentPattern.MatchString(parts[1]) ||
		(operation != "generate_image" && operation != "generate_video") || (inputMode != "text" && inputMode != "image" && inputMode != "reference") {
		return ModelPrices{}, errors.New("model_prices_request_invalid")
	}
	var result ModelPrices
	err := c.do(ctx, http.MethodGet, "/v1/models/"+model+"?view=pricing&operation="+operation+"&input_mode="+inputMode+query, "", nil, &result)
	if err == nil {
		err = result.Validate(model, operation, inputMode, filter)
	}
	if err != nil {
		return ModelPrices{}, err
	}
	return result, nil
}

func (v ModelPrices) Validate(model, operation, inputMode string, filters ...ModelPriceFilter) error {
	invalid := errors.New("model_prices_response_invalid")
	if len(filters) > 1 {
		return invalid
	}
	want, got := ModelPriceFilter{}, ModelPriceFilter{}
	if len(filters) == 1 {
		want = filters[0]
	}
	if v.Filter != nil {
		got = *v.Filter
	}
	if !want.valid(inputMode) || !got.valid(inputMode) || got.Resolution != strings.ToLower(want.Resolution) || (got.ReferenceCount == nil) != (want.ReferenceCount == nil) {
		return invalid
	}
	if got.ReferenceCount != nil && *got.ReferenceCount != *want.ReferenceCount {
		return invalid
	}
	if v.Object != "model_prices" || v.ID != model || v.Operation != operation || v.InputMode != inputMode || v.ContractVersion == "" ||
		(v.Coverage != "enumerated" && v.Coverage != "partial") || v.Issues == nil || v.Prices.Unavailable == nil || v.Prices.ExpiresAt <= 0 || v.Prices.ExpiresAt > maxPriceParameter {
		return invalid
	}
	for _, table := range []PriceTable{v.Prices.Primary, v.Prices.Max} {
		if !table.Valid() || table.Purpose != "yir-cost" || table.Unit != "USD" || table.Scale != 1000000 {
			return invalid
		}
		for _, row := range table.Rows {
			if row.Model != model || row.Operation != operation || len(row.Conditions["input_mode"]) != 1 || row.Conditions["input_mode"][0] != inputMode || !want.matches(row.Conditions) {
				return invalid
			}
		}
	}
	for _, row := range v.Prices.Unavailable {
		if (row.Basis != "primary" && row.Basis != "max") || row.Reason == "" || row.Model != model || row.Operation != operation || len(row.Conditions["input_mode"]) != 1 || row.Conditions["input_mode"][0] != inputMode {
			return invalid
		}
		table := v.Prices.Primary
		table.Rows = []PriceRow{{ID: row.ID, Model: row.Model, Operation: row.Operation, Conditions: row.Conditions, Kind: "exact", Price: TablePrice{Type: "total", Amount: "0"}}}
		if !table.Valid() || !want.matches(row.Conditions) {
			return invalid
		}
	}
	return nil
}

// BuildPriceInput applies bundled defaults and maps a Standard request to local
// table conditions. It never changes the original request or performs I/O.
func BuildPriceInput(operation string, request GenerationRequest, version string) (PriceInput, error) {
	if err := ValidateGeneration(operation, request); err != nil {
		return PriceInput{}, err
	}
	if request.Routing != nil {
		return PriceInput{}, errors.New("model_price_routing_override_unsupported")
	}
	contract, _ := GetModelOperationContract(request.Model, operation, request.Input.Type)
	parameters := map[string]any{}
	for _, rule := range contract.Parameters {
		if rule.Name == "seed" {
			continue
		}
		value, ok := request.Parameters[rule.Name]
		if !ok {
			value = rule.Default
		}
		if value != nil {
			parameters[rule.Name] = value
		}
	}
	parameters["input_mode"] = request.Input.Type
	parameters["resolution"] = strings.ToLower(parameters["resolution"].(string))
	if operation == "generate_image" {
		if _, ok := parameters["quality"]; !ok {
			parameters["quality"] = ""
		}
	} else if _, ok := parameters["duration"]; !ok {
		parameters["duration"] = 0
	}
	for _, role := range []string{"source_image", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"} {
		parameters[role+"_count"] = 0
	}
	for _, ref := range request.Input.References {
		key := ref.Role + "_count"
		parameters[key] = parameters[key].(int) + 1
	}
	model, _ := GetModelContract(request.Model)
	return PriceInput{Model: model.ID, Operation: operation, Parameters: parameters, Version: version}, nil
}
