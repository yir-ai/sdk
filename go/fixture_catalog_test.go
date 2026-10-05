package yir

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// The historical catalog in testdata is test input only; runtime validation
// uses the catalog the caller fetched from the API.
var bundledModelContractCatalog = mustLoadFixtureModelContractCatalog()

func mustLoadFixtureModelContractCatalog() ModelContractCatalog {
	raw, err := os.ReadFile("testdata/model-contracts.json")
	if err != nil {
		panic(err)
	}
	var catalog ModelContractCatalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		panic(fmt.Sprintf("decode fixture Yir model contracts: %v", err))
	}
	if catalog.SchemaVersion != "v1" || len(catalog.Models) == 0 {
		panic("fixture Yir model contracts are invalid")
	}
	normalizeGeneratedIntegerValues(&catalog)
	return catalog
}

func ListModelContracts() []StaticModelContract {
	return cloneStaticModelContracts(bundledModelContractCatalog.Models)
}

func GetModelContract(model string) (StaticModelContract, bool) {
	model = strings.TrimSpace(model)
	for _, contract := range bundledModelContractCatalog.Models {
		if model != "" && (contract.ID == model || containsString(contract.Aliases, model)) {
			return cloneStaticModelContract(contract), true
		}
	}
	return StaticModelContract{}, false
}

func GetModelOperationContract(model, operation, inputMode string) (ModelOperationContract, bool) {
	contract, ok := GetModelContract(model)
	if !ok {
		return ModelOperationContract{}, false
	}
	for _, candidate := range contract.Operations {
		if candidate.Operation == operation && containsString(candidate.InputModes, inputMode) {
			return cloneModelOperationContract(candidate), true
		}
	}
	return ModelOperationContract{}, false
}

func ValidateGeneration(operation string, request GenerationRequest) error {
	return ValidateGenerationWithCatalog(operation, request, bundledModelContractCatalog)
}

func ValidateModelParameters(model, operation, inputMode string, parameters map[string]any) error {
	contract, ok := GetModelOperationContract(model, operation, inputMode)
	if !ok {
		return &ParameterError{Path: "model", Code: "model_contract_unavailable"}
	}
	return validateParameters(contract.Parameters, parameters)
}
