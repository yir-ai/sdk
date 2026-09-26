package yir

import (
	"fmt"
	"math/big"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

// GenerationRequest is the common demand used for Quote and Submit.
// The endpoint selects image or video generation; provider fields are not accepted.
type GenerationRequest struct {
	Model      string          `json:"model"`
	Input      GenerationInput `json:"input"`
	Parameters map[string]any  `json:"parameters"`
	Routing    *Routing        `json:"routing,omitempty"`
}

type GenerationInput struct {
	Type       string      `json:"type"`
	Prompt     string      `json:"prompt"`
	References []Reference `json:"references,omitempty"`
}

// Reference preserves its position and explicit media role. Exactly one source is required.
type Reference struct {
	Role   string `json:"role"`
	URL    string `json:"url,omitempty"`
	FileID string `json:"file_id,omitempty"`
}

type Routing struct {
	Only       []string          `json:"only,omitempty"`
	Variants   map[string]string `json:"variants,omitempty"`
	Preference string            `json:"preference,omitempty"`
	Fallback   *bool             `json:"fallback,omitempty"`
}

// ValidateGeneration keeps the legacy explicit bundled-catalog check. Runtime
// clients use ValidateGenerationWithCatalog only when the caller supplies API data.
func ValidateGeneration(operation string, request GenerationRequest) error {
	return ValidateGenerationWithCatalog(operation, request, bundledModelContractCatalog)
}

// ValidateGenerationWithCatalog checks current caller-supplied model rules.
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
	if strings.TrimSpace(request.Model) == "" {
		return &ParameterError{"model", "model_required"}
	}
	if operation != "generate_image" && operation != "generate_video" {
		return &ParameterError{"operation", "invalid_operation"}
	}
	if request.Input.Type != "text" && request.Input.Type != "image" && request.Input.Type != "reference" || operation == "generate_image" && request.Input.Type == "reference" {
		return &ParameterError{"input.type", "input_mode_invalid"}
	}
	if strings.TrimSpace(request.Input.Prompt) == "" {
		return &ParameterError{"input.prompt", "required_parameter"}
	}
	if utf8.RuneCountInString(request.Input.Prompt) > 20000 {
		return &ParameterError{"input.prompt", "prompt_too_long"}
	}
	constraint := ModelInputConstraint{MaxReferences: 1 << 20}
	if contract != nil {
		var ok bool
		constraint, ok = contract.InputConstraints[request.Input.Type]
		if !ok {
			return &ParameterError{"input.type", "input_contract_unavailable"}
		}
	} else {
		if request.Input.Type == "text" {
			constraint.MaxReferences = 0
		} else {
			constraint.MinReferences = 1
		}
		if operation == "generate_image" {
			constraint.AllowedReferenceRoles = []string{"reference_image"}
		} else {
			constraint.AllowedReferenceRoles = []string{"first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"}
		}
	}
	if len(request.Input.References) < constraint.MinReferences || len(request.Input.References) > constraint.MaxReferences {
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
		if !containsString(constraint.AllowedReferenceRoles, reference.Role) {
			return &ParameterError{path + ".role", "invalid_reference_role"}
		}
		if (reference.URL == "") == (reference.FileID == "") {
			return &ParameterError{path, "reference_source_required"}
		}
		if reference.URL != "" {
			u, err := url.Parse(reference.URL)
			if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
				return &ParameterError{path + ".url", "invalid_reference_url"}
			}
		} else if !fileIDPattern.MatchString(reference.FileID) {
			return &ParameterError{path + ".file_id", "invalid_file_id"}
		}
		roles[reference.Role]++
	}
	for _, required := range constraint.RequiredReferenceRoles {
		if roles[required] == 0 {
			return &ParameterError{"input.references", "required_reference_role"}
		}
	}
	if operation == "generate_video" && request.Input.Type == "image" && (roles["first_frame"] != 1 || roles["last_frame"] > 1) {
		return &ParameterError{"input.references", "invalid_frame_roles"}
	}
	if contract != nil {
		if err := validateParameters(contract.Parameters, request.Parameters); err != nil {
			return err
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
	if contract != nil {
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

var fileIDPattern = regexp.MustCompile(`^file_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var providerCodePattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$`)

func validateRouting(routing *Routing) error {
	if routing == nil {
		return nil
	}
	if len(routing.Only) > 16 {
		return &ParameterError{"routing.only", "too_many_providers"}
	}
	seen := make(map[string]bool)
	for _, provider := range routing.Only {
		if len(provider) > 50 || !providerCodePattern.MatchString(provider) || seen[provider] {
			return &ParameterError{"routing.only", "invalid_provider"}
		}
		seen[provider] = true
	}
	if routing.Preference != "" && routing.Preference != "cost" && routing.Preference != "balanced" {
		return &ParameterError{"routing.preference", "invalid_enum"}
	}
	if len(routing.Variants) > 16 {
		return &ParameterError{"routing.variants", "too_many_variants"}
	}
	for provider, variant := range routing.Variants {
		if len(provider) > 50 || len(variant) > 50 || !providerCodePattern.MatchString(provider) || !providerCodePattern.MatchString(variant) {
			return &ParameterError{"routing.variants", "invalid_variant"}
		}
		if len(routing.Only) > 0 && !seen[provider] && !seen["official"] {
			return &ParameterError{"routing.variants", "provider_outside_allowlist"}
		}
	}
	return nil
}
