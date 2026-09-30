package yir

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

// ModelDetail is the Market detail for one canonical model: specifications,
// channel prices and declared parameter handling. Unknown fields are ignored.
type ModelDetail struct {
	ID                string               `json:"id"`
	Object            string               `json:"object"`
	Specifications    []ModelSpecification `json:"specifications"`
	ChannelParameters []ChannelParameters  `json:"channel_parameters,omitempty"`
}

type ModelSpecification struct {
	RequestModelID     string              `json:"request_model_id"`
	Operation          string              `json:"operation"`
	InputMode          string              `json:"input_mode"`
	SpecificationLabel string              `json:"specification_label"`
	Currency           string              `json:"currency"`
	Channels           []ModelChannelPrice `json:"channels"`
}

// ModelChannelPrice is display pricing, not a quote. AmountMicros is nil when no price is published.
type ModelChannelPrice struct {
	ProviderCode       string `json:"provider_code"`
	ProviderLabel      string `json:"provider_label"`
	AmountMicros       *int64 `json:"amount_micros,omitempty"`
	Availability       string `json:"availability"`
	Estimated          bool   `json:"estimated"`
	SpecificationLabel string `json:"specification_label"`
}

// GetModel reads the Market detail for a canonical creator/model ID. Aliases are not resource paths.
func (c *Client) GetModel(ctx context.Context, model string) (ModelDetail, error) {
	if !validModelContractPath(model) {
		return ModelDetail{}, errors.New("model_request_invalid")
	}
	var raw json.RawMessage
	if err := c.do(ctx, http.MethodGet, "/v1/models/"+model, "", nil, &raw); err != nil {
		return ModelDetail{}, err
	}
	var detail ModelDetail
	// Estimated is a plain bool in the released type, so required presence is checked separately.
	var presence struct {
		Specifications []struct {
			Channels []struct {
				Estimated *bool `json:"estimated"`
			} `json:"channels"`
		} `json:"specifications"`
	}
	if json.Unmarshal(raw, &detail) != nil || json.Unmarshal(raw, &presence) != nil || !validModelDetail(detail, model) {
		return ModelDetail{}, errors.New("model_response_invalid")
	}
	for _, specification := range presence.Specifications {
		for _, channel := range specification.Channels {
			if channel.Estimated == nil {
				return ModelDetail{}, errors.New("model_response_invalid")
			}
		}
	}
	return detail, nil
}

func validModelDetail(detail ModelDetail, model string) bool {
	if detail.ID != model || detail.Object != "model" || len(detail.Specifications) == 0 {
		return false
	}
	for _, specification := range detail.Specifications {
		if !validModelContractPath(specification.RequestModelID) || !validModelOperation(specification.Operation) ||
			!validModelInputMode(specification.InputMode) || specification.SpecificationLabel == "" ||
			specification.Currency != "USD" || len(specification.Channels) == 0 {
			return false
		}
		for _, channel := range specification.Channels {
			if channel.ProviderCode == "" || channel.ProviderLabel == "" || channel.SpecificationLabel == "" ||
				channel.Availability != "available" && channel.Availability != "unavailable" ||
				channel.AmountMicros != nil && *channel.AmountMicros < 0 {
				return false
			}
		}
	}
	for _, channel := range detail.ChannelParameters {
		if channel.Provider == "" || channel.ChannelVariant == "" || channel.ParameterRules == nil || !validModelOperation(channel.Operation) || !validModelInputMode(channel.InputMode) {
			return false
		}
		for _, rule := range channel.ParameterRules {
			if rule.Behavior != "supported" && rule.Behavior != "ignored" && rule.Behavior != "rejected" {
				return false
			}
		}
	}
	return true
}

func validModelOperation(operation string) bool {
	return operation == "generate_image" || operation == "generate_video"
}

func validModelInputMode(mode string) bool {
	return mode == "text" || mode == "image" || mode == "reference"
}
