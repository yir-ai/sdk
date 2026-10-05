package yir

import (
	"maps"
)

type ModelContractLocale struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

type ModelParameterContract struct {
	Name     string                         `json:"name"`
	Type     string                         `json:"type"`
	Required bool                           `json:"required"`
	Values   []any                          `json:"values,omitempty"`
	Default  any                            `json:"default,omitempty"`
	Minimum  *float64                       `json:"minimum,omitempty"`
	Maximum  *float64                       `json:"maximum,omitempty"`
	Control  string                         `json:"control"`
	Locales  map[string]ModelContractLocale `json:"locales"`
}

type ModelInputConstraint struct {
	MinReferences              int                            `json:"min_references"`
	MaxReferences              int                            `json:"max_references"`
	AllowedReferenceRoles      []string                       `json:"allowed_reference_roles"`
	RequiredReferenceRoles     []string                       `json:"required_reference_roles,omitempty"`
	MaxDurationByReferenceRole map[string]int                 `json:"max_duration_by_reference_role,omitempty"`
	ReferenceCountsByRole      map[string]ReferenceCountRange `json:"reference_counts_by_role,omitempty"`
	RequiredAnyReferenceRoles  []string                       `json:"required_any_reference_roles,omitempty"`
}

// localTypeKnown reports whether this SDK can check values of the parameter's type;
// newer types are left to the Gateway.
func (p ModelParameterContract) localTypeKnown() bool {
	return p.Type == "string" || p.Type == "integer" || p.Type == "number" || p.Type == "boolean"
}

type ReferenceCountRange struct {
	Minimum int `json:"minimum"`
	Maximum int `json:"maximum"`
}

type ModelOperationContract struct {
	Operation        string                          `json:"operation"`
	InputModes       []string                        `json:"input_modes"`
	InputConstraints map[string]ModelInputConstraint `json:"input_constraints"`
	RequestSchema    string                          `json:"request_schema"`
	Parameters       []ModelParameterContract        `json:"parameters"`
}

type StaticModelContract struct {
	ID         string                         `json:"id"`
	Aliases    []string                       `json:"aliases"`
	Locales    map[string]ModelContractLocale `json:"locales"`
	Operations []ModelOperationContract       `json:"operations"`
}

type ModelContractCatalog struct {
	SchemaVersion string                `json:"schema_version"`
	SchemaRef     string                `json:"schema_ref"`
	Version       string                `json:"version,omitempty"`
	Models        []StaticModelContract `json:"models"`
}

func normalizeGeneratedIntegerValues(catalog *ModelContractCatalog) {
	for modelIndex := range catalog.Models {
		for operationIndex := range catalog.Models[modelIndex].Operations {
			parameters := catalog.Models[modelIndex].Operations[operationIndex].Parameters
			for parameterIndex := range parameters {
				parameter := &parameters[parameterIndex]
				if parameter.Type != "integer" {
					continue
				}
				parameter.Default = jsonNumberToInt(parameter.Default)
				for valueIndex := range parameter.Values {
					parameter.Values[valueIndex] = jsonNumberToInt(parameter.Values[valueIndex])
				}
			}
		}
	}
}

func jsonNumberToInt(value any) any {
	number, ok := value.(float64)
	if !ok {
		return value
	}
	integer := int(number)
	if float64(integer) == number {
		return integer
	}
	return value
}

func cloneStaticModelContracts(source []StaticModelContract) []StaticModelContract {
	result := make([]StaticModelContract, len(source))
	for index, contract := range source {
		result[index] = cloneStaticModelContract(contract)
	}
	return result
}

func cloneStaticModelContract(source StaticModelContract) StaticModelContract {
	result := source
	result.Aliases = append([]string(nil), source.Aliases...)
	result.Locales = cloneModelContractLocales(source.Locales)
	result.Operations = make([]ModelOperationContract, len(source.Operations))
	for index, operation := range source.Operations {
		result.Operations[index] = cloneModelOperationContract(operation)
	}
	return result
}

func cloneModelOperationContract(source ModelOperationContract) ModelOperationContract {
	result := source
	result.InputModes = append([]string(nil), source.InputModes...)
	result.InputConstraints = make(map[string]ModelInputConstraint, len(source.InputConstraints))
	for inputMode, constraint := range source.InputConstraints {
		constraint.AllowedReferenceRoles = append([]string(nil), constraint.AllowedReferenceRoles...)
		constraint.RequiredReferenceRoles = append([]string(nil), constraint.RequiredReferenceRoles...)
		constraint.ReferenceCountsByRole = maps.Clone(constraint.ReferenceCountsByRole)
		constraint.RequiredAnyReferenceRoles = append([]string(nil), constraint.RequiredAnyReferenceRoles...)
		constraint.MaxDurationByReferenceRole = cloneStringIntMap(constraint.MaxDurationByReferenceRole)
		result.InputConstraints[inputMode] = constraint
	}
	result.Parameters = make([]ModelParameterContract, len(source.Parameters))
	for index, parameter := range source.Parameters {
		parameter.Values = append([]any(nil), parameter.Values...)
		parameter.Minimum = cloneFloatPointer(parameter.Minimum)
		parameter.Maximum = cloneFloatPointer(parameter.Maximum)
		parameter.Locales = cloneModelContractLocales(parameter.Locales)
		result.Parameters[index] = parameter
	}
	return result
}

func cloneFloatPointer(source *float64) *float64 {
	if source == nil {
		return nil
	}
	value := *source
	return &value
}

func cloneModelContractLocales(source map[string]ModelContractLocale) map[string]ModelContractLocale {
	result := make(map[string]ModelContractLocale, len(source))
	for locale, value := range source {
		result[locale] = value
	}
	return result
}

func cloneStringIntMap(source map[string]int) map[string]int {
	if source == nil {
		return nil
	}
	result := make(map[string]int, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
