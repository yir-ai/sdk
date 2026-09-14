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
	BaseURL    string
	HTTPClient *http.Client
}

type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
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
	return &Client{strings.TrimRight(baseURL, "/"), apiKey, &httpClient}, nil
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

func (e *APIError) Error() string { return fmt.Sprintf("yir HTTP %d: %s", e.Status, e.Code) }

func (c *Client) QuoteImage(ctx context.Context, request GenerationRequest) (Quote, error) {
	return c.quote(ctx, "images", "generate_image", request)
}

func (c *Client) QuoteVideo(ctx context.Context, request GenerationRequest) (Quote, error) {
	return c.quote(ctx, "videos", "generate_video", request)
}

func (c *Client) quote(ctx context.Context, resource, operation string, request GenerationRequest) (Quote, error) {
	var quote Quote
	if request.Parameters == nil {
		request.Parameters = map[string]any{}
	}
	if err := ValidateGeneration(operation, request); err != nil {
		return quote, err
	}
	warnParameterPolicies(operation, request)
	err := c.do(ctx, http.MethodPost, "/v1/"+resource+"/quotes", "", request, &quote)
	if err == nil {
		err = quote.Validate()
	}
	if err == nil {
		requested, requestKnown := GetModelContract(request.Model)
		returned, responseKnown := GetModelContract(quote.Model)
		if !requestKnown || !responseKnown || requested.ID != returned.ID || quote.Operation != operation || quote.InputMode != request.Input.Type {
			err = errors.New("quote_response_invalid")
		}
	}
	return quote, err
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
func warnParameterPolicies(operation string, request GenerationRequest) {
	contract, ok := GetModelOperationContract(request.Model, operation, request.Input.Type)
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
	if err := ValidateGeneration(operation, request.GenerationRequest); err != nil {
		return job, err
	}
	warnParameterPolicies(operation, request.GenerationRequest)
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
