package yir

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
)

// GenerationRequest is the common demand used for Quote and Submit.
// The endpoint selects image or video generation; provider fields are not accepted.
type GenerationRequest struct {
	BillingMode string          `json:"billing_mode,omitempty"`
	Model       string          `json:"model"`
	Input       GenerationInput `json:"input"`
	Parameters  map[string]any  `json:"parameters"`
	Routing     *Routing        `json:"routing,omitempty"`
	// Extra carries top-level request fields newer than this SDK; the Gateway
	// validates them. Fields this SDK models (see reservedRequestFields) are
	// rejected by validation and never sent from Extra. Unmarshal restores it.
	Extra map[string]any `json:"-"`
}

// reservedRequestFields are the top-level fields GenerationRequest and SubmitRequest model.
var reservedRequestFields = map[string]bool{"billing_mode": true, "model": true, "input": true, "parameters": true,
	"routing": true, "max_cost": true, "webhook_url": true}

func (r GenerationRequest) MarshalJSON() ([]byte, error) {
	type plain GenerationRequest
	return marshalWithExtra(plain(r), r.Extra)
}

func (r *GenerationRequest) UnmarshalJSON(data []byte) error {
	type plain GenerationRequest
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	extra, err := unmarshalExtra(data)
	*r = GenerationRequest(value)
	r.Extra = extra
	return err
}

func marshalWithExtra(value any, extra map[string]any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil || len(extra) == 0 {
		return data, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	for key, item := range extra {
		if reservedRequestFields[key] {
			continue
		}
		if fields[key], err = json.Marshal(item); err != nil {
			return nil, err
		}
	}
	return json.Marshal(fields)
}

// unmarshalExtra keeps unmodeled top-level fields so a persisted request round-trips.
func unmarshalExtra(data []byte) (map[string]any, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	var extra map[string]any
	for key, raw := range fields {
		if reservedRequestFields[key] {
			continue
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		var value any
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		if extra == nil {
			extra = make(map[string]any)
		}
		extra[key] = value
	}
	return extra, nil
}

type GenerationInput struct {
	Type       string      `json:"type"`
	Prompt     string      `json:"prompt"`
	References []Reference `json:"references,omitempty"`
}

// Reference preserves its position and explicit media role. Role names are
// model contract data; the Gateway decides which roles and sources it accepts.
type Reference struct {
	Role string `json:"role"`
	// URL is a public HTTPS URL that Yir imports at submission (up to 100 MiB);
	// use FileID for larger media. Set exactly one of URL or FileID.
	URL    string `json:"url,omitempty"`
	FileID string `json:"file_id,omitempty"`
}

// Routing preferences known to this SDK release. Routing.Preference is a
// plain string and the Gateway validates it, so newer values need no release.
const (
	// RoutingPreferenceCost orders channels by ascending price. It is the
	// Gateway default when Preference is empty.
	RoutingPreferenceCost = "cost"
	// RoutingPreferenceSpeed orders channels by ascending observed upstream
	// latency; channels with too few samples follow in price order.
	RoutingPreferenceSpeed = "speed"
)

type Routing struct {
	Only     []string          `json:"only,omitempty"`
	Variants map[string]string `json:"variants,omitempty"`
	// Preference is one of the RoutingPreference constants; empty uses the
	// Gateway default (cost).
	Preference string `json:"preference,omitempty"`
	Fallback   *bool  `json:"fallback,omitempty"`
}

// ValidateGeneration checks against the historical catalog bundled with this
// SDK version, so models published later fail with model_contract_unavailable.
//
// Deprecated: use ValidateGenerationWithCatalog with GetModelContracts data, or
// ValidateGenerationProtocol, which runtime clients use when no catalog is set.
func ValidateGeneration(operation string, request GenerationRequest) error {
	return ValidateGenerationWithCatalog(operation, request, bundledModelContractCatalog)
}

// ValidateGenerationWithCatalog checks current caller-supplied model rules and
// rejects models, operations and input modes the catalog does not describe.
// Clients configured with ModelContracts instead leave those to the Gateway.
// It does not determine current price, supply, media usage or authorization.
func ValidateGenerationWithCatalog(operation string, request GenerationRequest, catalog ModelContractCatalog) error {
	model, ok := findContractInCatalog(catalog, request.Model)
	if !ok {
		return &ParameterError{"model", "model_contract_unavailable"}
	}
	var contract *ModelOperationContract
	for i := range model.Operations {
		candidate := &model.Operations[i]
		if candidate.Operation == operation && containsString(candidate.InputModes, request.Input.Type) {
			contract = candidate
			break
		}
	}
	if contract == nil {
		return &ParameterError{"input.type", "operation_contract_unavailable"}
	}
	return validateGenerationWithContract(operation, request, contract)
}

// ValidateGenerationProtocol checks only stable request structure. New models
// are left for the Gateway unless the caller provides a current catalog.
func ValidateGenerationProtocol(operation string, request GenerationRequest) error {
	return validateGenerationWithContract(operation, request, nil)
}

func validateGenerationWithContract(operation string, request GenerationRequest, contract *ModelOperationContract) error {
	if request.BillingMode != "" {
		if request.BillingMode != "actual" {
			return &ParameterError{"billing_mode", "invalid_value"}
		}
		if request.Routing == nil || len(request.Routing.Only) == 0 {
			return &ParameterError{"routing.only", "required_parameter"}
		}
	}
	if strings.TrimSpace(request.Model) == "" {
		return &ParameterError{"model", "model_required"}
	}
	if operation != "generate_image" && operation != "generate_video" {
		return &ParameterError{"operation", "invalid_operation"}
	}
	if request.Input.Type == "" {
		return &ParameterError{"input.type", "input_mode_invalid"}
	}
	if strings.TrimSpace(request.Input.Prompt) == "" {
		return &ParameterError{"input.prompt", "required_parameter"}
	}
	for key := range request.Extra {
		if reservedRequestFields[key] {
			return &ParameterError{"extra." + key, "reserved_field"}
		}
	}
	var constraint *ModelInputConstraint
	if contract != nil {
		declared, ok := contract.InputConstraints[request.Input.Type]
		if !ok {
			return &ParameterError{"input.type", "input_contract_unavailable"}
		}
		constraint = &declared
	}
	count := len(request.Input.References)
	if request.Input.Type == "text" && count != 0 || (request.Input.Type == "image" || request.Input.Type == "reference") && count == 0 ||
		constraint != nil && (count < constraint.MinReferences || count > constraint.MaxReferences) {
		return &ParameterError{"input.references", "invalid_reference_count"}
	}
	roles := make(map[string]int)
	seenReferences := make(map[Reference]bool)
	for i, reference := range request.Input.References {
		path := fmt.Sprintf("input.references[%d]", i)
		if seenReferences[reference] {
			return &ParameterError{"input.references", "duplicate_reference"}
		}
		seenReferences[reference] = true
		if reference.Role == "" || constraint != nil && !containsString(constraint.AllowedReferenceRoles, reference.Role) {
			return &ParameterError{path + ".role", "invalid_reference_role"}
		}
		roles[reference.Role]++
	}
	if contract != nil {
		if err := validateParameters(contract.Parameters, request.Parameters); err != nil {
			return err
		}
	}
	if constraint != nil {
		for _, required := range constraint.RequiredReferenceRoles {
			if roles[required] == 0 {
				return &ParameterError{"input.references", "required_reference_role"}
			}
		}
		for role, limit := range constraint.ReferenceCountsByRole {
			if roles[role] < limit.Minimum || roles[role] > limit.Maximum {
				return &ParameterError{"input.references", "invalid_reference_role_count"}
			}
		}
		if len(constraint.RequiredAnyReferenceRoles) > 0 {
			found := false
			for _, role := range constraint.RequiredAnyReferenceRoles {
				found = found || roles[role] > 0
			}
			if !found {
				return &ParameterError{"input.references", "required_reference_role"}
			}
		}
		var duration any = request.Parameters["duration"]
		if duration == nil {
			for _, parameter := range contract.Parameters {
				if parameter.Name == "duration" {
					duration = parameter.Default
				}
			}
		}
		normalizedDuration, _ := normalizeParameter(duration)
		seconds, hasDuration := parameterInteger(normalizedDuration)
		for role, maximum := range constraint.MaxDurationByReferenceRole {
			if roles[role] > 0 && hasDuration && seconds.Cmp(big.NewInt(int64(maximum))) > 0 {
				return &ParameterError{"parameters.duration", "reference_duration_limit"}
			}
		}
	}
	return validateRouting(request.Routing)
}

func findContractInCatalog(catalog ModelContractCatalog, model string) (StaticModelContract, bool) {
	for _, contract := range catalog.Models {
		if contract.ID == model || containsString(contract.Aliases, model) {
			return contract, true
		}
	}
	return StaticModelContract{}, false
}

// validateRouting checks value shapes only; provider codes, preferences and
// limits are Gateway facts so newer values do not need an SDK release.
func validateRouting(routing *Routing) error {
	if routing == nil {
		return nil
	}
	seen := make(map[string]bool)
	for _, provider := range routing.Only {
		if provider == "" || seen[provider] {
			return &ParameterError{"routing.only", "invalid_provider"}
		}
		seen[provider] = true
	}
	for provider, variant := range routing.Variants {
		if provider == "" || variant == "" {
			return &ParameterError{"routing.variants", "invalid_variant"}
		}
	}
	return nil
}
