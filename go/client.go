package yir

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const DefaultBaseURL = "https://gateway.yir.ai"

type ClientOptions struct {
	BaseURL        string
	HTTPClient     *http.Client
	ModelContracts *ModelContractCatalog
}

type Client struct {
	baseURL        string
	apiKey         string
	httpClient     *http.Client
	modelContracts *ModelContractCatalog
}

// NewClient performs no network requests. A custom BaseURL supports private gateways.
func NewClient(apiKey string, options ClientOptions) (*Client, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" || strings.ContainsAny(apiKey, "\r\n") {
		return nil, errors.New("api_key_invalid")
	}
	baseURL := options.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	u, err := url.Parse(baseURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("base_url_invalid")
	}
	httpClient := http.Client{Timeout: 30 * time.Second}
	if options.HTTPClient != nil {
		httpClient = *options.HTTPClient
	}
	// Redirects are not part of the Gateway API contract. Never forward credentials.
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	var catalog *ModelContractCatalog
	if options.ModelContracts != nil {
		if !validRemoteModelContracts(*options.ModelContracts) {
			return nil, errors.New("model_contract_invalid")
		}
		copy := *options.ModelContracts
		copy.Models = cloneStaticModelContracts(copy.Models)
		catalog = &copy
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey, httpClient: &httpClient, modelContracts: catalog}, nil
}

type SubmitRequest struct {
	GenerationRequest
	MaxCost    *string `json:"max_cost,omitempty"`
	WebhookURL string  `json:"webhook_url,omitempty"`
}

type APIError struct {
	Status    int    `json:"-"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
	Action    string `json:"action,omitempty"`
}

func (e *APIError) Error() string {
	if e.Status == 0 {
		return "yir: " + e.Code
	}
	return fmt.Sprintf("yir HTTP %d: %s", e.Status, e.Code)
}

func (c *Client) QuoteImage(ctx context.Context, request GenerationRequest) (Quote, error) {
	return c.quote(ctx, "images", "generate_image", request)
}

func (c *Client) QuoteVideo(ctx context.Context, request GenerationRequest) (Quote, error) {
	return c.quote(ctx, "videos", "generate_video", request)
}

// QuoteBatch quotes explicit image and video requests together. Invalid items
// are returned in their own positions so one model does not hide other quotes.
func (c *Client) QuoteBatch(ctx context.Context, requests []QuoteBatchRequestItem) (QuoteBatch, error) {
	var batch QuoteBatch
	if len(requests) == 0 || len(requests) > 20 {
		return batch, errors.New("quote_batch_request_invalid")
	}
	prepared := make([]QuoteBatchRequestItem, len(requests))
	copy(prepared, requests)
	for i := range prepared {
		if prepared[i].Request.Parameters == nil {
			prepared[i].Request.Parameters = map[string]any{}
		}
	}
	if err := c.do(ctx, http.MethodPost, "/v1/quotes", "", struct {
		Requests []QuoteBatchRequestItem `json:"requests"`
	}{Requests: prepared}, &batch); err != nil {
		return batch, err
	}
	if batch.Object != "quote_batch" || strings.TrimSpace(batch.RequestID) == "" || len(batch.Data) != len(requests) {
		return QuoteBatch{}, errors.New("quote_batch_response_invalid")
	}
	for index, item := range batch.Data {
		if item.Index != index || (item.Quote == nil) == (item.Error == nil) {
			return QuoteBatch{}, errors.New("quote_batch_response_invalid")
		}
		if item.Error != nil {
			if item.Error.Code != "YIR_INVALID_REQUEST" || strings.TrimSpace(item.Error.Message) == "" || item.Error.Retryable || item.Error.Action != "fix_request" {
				return QuoteBatch{}, errors.New("quote_batch_response_invalid")
			}
			continue
		}
		request := requests[index]
		if err := item.Quote.Validate(); err != nil || !c.quoteMatchesRequest(*item.Quote, request.Request, request.Operation) {
			return QuoteBatch{}, errors.New("quote_batch_response_invalid")
		}
	}
	return batch, nil
}

func (c *Client) validateGeneration(operation string, request GenerationRequest) error {
	if c != nil && c.modelContracts != nil {
		return ValidateGenerationWithCatalog(operation, request, *c.modelContracts)
	}
	return ValidateGenerationProtocol(operation, request)
}

func (c *Client) quote(ctx context.Context, resource, operation string, request GenerationRequest) (Quote, error) {
	var quote Quote
	if request.Parameters == nil {
		request.Parameters = map[string]any{}
	}
	if err := c.validateGeneration(operation, request); err != nil {
		return quote, err
	}
	warnParameterPolicies(operation, request, c.modelContracts)
	err := c.do(ctx, http.MethodPost, "/v1/"+resource+"/quotes", "", request, &quote)
	if err == nil {
		err = quote.Validate()
	}
	if err == nil && !c.quoteMatchesRequest(quote, request, operation) {
		err = errors.New("quote_response_invalid")
	}
	return quote, err
}

func (c *Client) quoteMatchesRequest(quote Quote, request GenerationRequest, operation string) bool {
	expectedModel := request.Model
	returnedModel := quote.Model
	if c != nil && c.modelContracts != nil {
		if requested, found := findContractInCatalog(*c.modelContracts, request.Model); found {
			expectedModel = requested.ID
		}
		if returned, found := findContractInCatalog(*c.modelContracts, quote.Model); found {
			returnedModel = returned.ID
		}
	}
	return returnedModel == expectedModel && quote.Operation == operation && quote.InputMode == request.Input.Type
}

func (c *Client) SubmitImage(ctx context.Context, request SubmitRequest, idempotencyKey string) (Job, error) {
	return c.submit(ctx, "images", "generate_image", request, idempotencyKey)
}

func (c *Client) SubmitVideo(ctx context.Context, request SubmitRequest, idempotencyKey string) (Job, error) {
	return c.submit(ctx, "videos", "generate_video", request, idempotencyKey)
}

var decimalCostPattern = regexp.MustCompile(`^[0-9]{1,13}(\.[0-9]{1,6})?$`)
var jobIDPattern = regexp.MustCompile(`^[1-9][0-9]*$`)

// 只记录固定说明，不将输入内容或参数值写入日志。
func warnParameterPolicies(operation string, request GenerationRequest, catalogs ...*ModelContractCatalog) {
	var contract ModelOperationContract
	var ok bool
	if len(catalogs) == 0 {
		contract, ok = GetModelOperationContract(request.Model, operation, request.Input.Type)
	} else if catalogs[0] != nil {
		model, found := findContractInCatalog(*catalogs[0], request.Model)
		if found {
			for _, candidate := range model.Operations {
				if candidate.Operation == operation && containsString(candidate.InputModes, request.Input.Type) {
					contract, ok = candidate, true
					break
				}
			}
		}
	}
	if !ok {
		return
	}
	for _, parameter := range contract.Parameters {
		_, provided := request.Parameters[parameter.Name]
		policy := parameter.Policy
		if !provided || policy == nil {
			continue
		}
		if request.Routing != nil && len(request.Routing.Only) == 1 && request.Routing.Only[0] == policy.OnlyProvider {
			continue
		}
		log.Print("[Yir] " + policy.Message)
	}
}

func (c *Client) submit(ctx context.Context, resource, operation string, request SubmitRequest, key string) (Job, error) {
	var job Job
	if request.Parameters == nil {
		request.Parameters = map[string]any{}
	}
	key = strings.TrimSpace(key)
	if key == "" || strings.ContainsAny(key, "\r\n") {
		return job, errors.New("idempotency_key_invalid")
	}
	if err := c.validateGeneration(operation, request.GenerationRequest); err != nil {
		return job, err
	}
	warnParameterPolicies(operation, request.GenerationRequest, c.modelContracts)
	if request.MaxCost != nil {
		amount, ok := new(big.Rat).SetString(*request.MaxCost)
		maximum, _ := new(big.Rat).SetString("9223372036854.775807")
		if !decimalCostPattern.MatchString(*request.MaxCost) || !ok || amount.Cmp(maximum) > 0 {
			return job, &ParameterError{"max_cost", "invalid_amount"}
		}
	}
	if request.WebhookURL != "" {
		u, err := url.Parse(request.WebhookURL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
			return job, &ParameterError{"webhook_url", "invalid_url"}
		}
	}
	// Submit is issued once. An unknown transport outcome must reuse the caller's key.
	err := c.do(ctx, http.MethodPost, "/v1/"+resource+"/generations", key, request, &job)
	if err == nil && (!jobIDPattern.MatchString(job.ID) || !validJobStatus(job.Status)) {
		err = errors.New("response_invalid")
	}
	return job, err
}

func (c *Client) GetJob(ctx context.Context, id string) (Job, error) {
	var job Job
	if !jobIDPattern.MatchString(id) {
		return job, errors.New("job_id_invalid")
	}
	err := c.do(ctx, http.MethodGet, "/v1/jobs/"+id, "", nil, &job)
	if err == nil && (job.ID != id || !validJobStatus(job.Status)) {
		err = errors.New("response_invalid")
	}
	return job, err
}

func (c *Client) GetJobStatus(ctx context.Context, id string) (JobStatusResponse, error) {
	var status JobStatusResponse
	if !jobIDPattern.MatchString(id) {
		return status, errors.New("job_id_invalid")
	}
	err := c.do(ctx, http.MethodGet, "/v1/jobs/"+id+"/status", "", nil, &status)
	if err == nil && (status.ID != id || !validJobStatus(status.Status)) {
		err = errors.New("response_invalid")
	}
	return status, err
}

func (c *Client) CancelJob(ctx context.Context, id string) (Job, error) {
	var job Job
	if !jobIDPattern.MatchString(id) {
		return job, errors.New("job_id_invalid")
	}
	err := c.do(ctx, http.MethodPost, "/v1/jobs/"+id+"/cancel", "", nil, &job)
	if err == nil && (job.ID != id || !validJobStatus(job.Status)) {
		err = errors.New("response_invalid")
	}
	return job, err
}

func (c *Client) do(ctx context.Context, method, path, key string, body, response any) error {
	if c == nil || c.httpClient == nil {
		return errors.New("client_uninitialized")
	}
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			return errors.New("request_encoding_failed")
		}
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return errors.New("request_creation_failed")
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("User-Agent", "yir-go/0.1.0")
	request.Header.Set("Accept", "application/json")
	// net/http may otherwise replay a request carrying Idempotency-Key after a
	// connection failure. Recovery belongs to the caller with the original key.
	request.GetBody = nil
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		request.Header.Set("Idempotency-Key", key)
	}
	result, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer result.Body.Close()
	const maximumResponseBytes = 2 << 20
	raw, err := io.ReadAll(io.LimitReader(result.Body, maximumResponseBytes+1))
	if err != nil {
		return err
	}
	if len(raw) > maximumResponseBytes {
		return errors.New("response_too_large")
	}
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		var envelope struct {
			Error *APIError `json:"error"`
		}
		if json.Unmarshal(raw, &envelope) != nil || envelope.Error == nil || envelope.Error.Code == "" {
			return &APIError{Status: result.StatusCode, Code: "http_error"}
		}
		envelope.Error.Status = result.StatusCode
		return envelope.Error
	}
	if json.Unmarshal(raw, response) != nil {
		return errors.New("response_invalid")
	}
	return nil
}
