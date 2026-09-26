package yir

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
)

type ModelContractDetail struct {
	SchemaVersion string              `json:"schema_version"`
	SchemaRef     string              `json:"schema_ref"`
	Version       string              `json:"version"`
	Model         StaticModelContract `json:"model"`
}

var modelContractPathPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$`)
var modelContractVersionPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (c *Client) GetModelContracts(ctx context.Context) (ModelContractCatalog, error) {
	var raw json.RawMessage
	if err := c.do(ctx, http.MethodGet, "/v1/models?include=parameters", "", nil, &raw); err != nil {
		return ModelContractCatalog{}, err
	}
	var catalog ModelContractCatalog
	if err := decodeModelContract(raw, &catalog); err != nil || !validRemoteModelContracts(catalog) {
		return ModelContractCatalog{}, errors.New("model_contract_response_invalid")
	}
	normalizeGeneratedIntegerValues(&catalog)
	return catalog, nil
}

func (c *Client) GetModelContract(ctx context.Context, model string) (ModelContractDetail, error) {
	if !validModelContractPath(model) {
		return ModelContractDetail{}, errors.New("model_contract_request_invalid")
	}
	var raw json.RawMessage
	if err := c.do(ctx, http.MethodGet, "/v1/models/"+model+"?view=contract", "", nil, &raw); err != nil {
		return ModelContractDetail{}, err
	}
	var detail ModelContractDetail
	if err := decodeModelContract(raw, &detail); err != nil || !validRemoteModelContracts(ModelContractCatalog{
		SchemaVersion: detail.SchemaVersion, SchemaRef: detail.SchemaRef,
		Version: detail.Version, Models: []StaticModelContract{detail.Model},
	}) || detail.Model.ID != model {
		return ModelContractDetail{}, errors.New("model_contract_response_invalid")
	}
	catalog := ModelContractCatalog{Models: []StaticModelContract{detail.Model}}
	normalizeGeneratedIntegerValues(&catalog)
	detail.Model = catalog.Models[0]
	return detail, nil
}

func decodeModelContract(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("model_contract_response_invalid")
	}
	return nil
}

func validModelContractPath(model string) bool {
	if !modelContractPathPattern.MatchString(model) {
		return false
	}
	parts := strings.Split(model, "/")
	return len(parts[0]) <= 100 && len(parts[1]) <= 100
}

func validRemoteModelContracts(catalog ModelContractCatalog) bool {
	if catalog.SchemaVersion != "v1" || catalog.SchemaRef == "" || !modelContractVersionPattern.MatchString(catalog.Version) || len(catalog.Models) == 0 {
		return false
	}
	seen := make(map[string]bool)
	for _, model := range catalog.Models {
		if !validModelContractPath(model.ID) || len(model.Operations) == 0 || seen[model.ID] {
			return false
		}
		seen[model.ID] = true
		for _, alias := range model.Aliases {
			if alias == "" || strings.TrimSpace(alias) != alias || len(alias) > 200 || seen[alias] {
				return false
			}
			seen[alias] = true
		}
		for _, operation := range model.Operations {
			if operation.Operation != "generate_image" && operation.Operation != "generate_video" && operation.Operation != "upscale_image" || len(operation.InputModes) == 0 {
				return false
			}
			for _, mode := range operation.InputModes {
				if mode != "text" && mode != "image" && mode != "reference" {
					return false
				}
				if _, ok := operation.InputConstraints[mode]; !ok {
					return false
				}
			}
			for _, parameter := range operation.Parameters {
				if parameter.Name == "" || parameter.Type != "string" && parameter.Type != "integer" && parameter.Type != "number" && parameter.Type != "boolean" {
					return false
				}
			}
		}
	}
	return true
}
