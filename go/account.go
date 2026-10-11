package yir

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

const DefaultAccountBaseURL = "https://api.yir.ai/account/v1"

// AccountClient exposes only the owner's Account API, never the internal Admin API.
type AccountClient struct{ client *Client }

func NewAccountClient(accountKey string, options ClientOptions) (*AccountClient, error) {
	if !strings.HasPrefix(accountKey, "yir_ak_") || strings.ContainsAny(accountKey, " \r\n\t") {
		return nil, errors.New("account_key_required")
	}
	if options.BaseURL == "" {
		options.BaseURL = DefaultAccountBaseURL
	}
	client, err := NewClient(accountKey, options)
	if err != nil {
		return nil, err
	}
	return &AccountClient{client: client}, nil
}

func (c *AccountClient) request(ctx context.Context, method, path string, input, output any) error {
	if c == nil || c.client == nil {
		return errors.New("client_uninitialized")
	}
	var envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err := c.client.do(ctx, method, path, "", input, &envelope); err != nil {
		return err
	}
	if envelope.Code != 200 {
		return errors.New("account_response_invalid")
	}
	if output != nil && json.Unmarshal(envelope.Data, output) != nil {
		return errors.New("account_response_invalid")
	}
	return nil
}

func accountQuery(path string, query url.Values) string {
	if len(query) == 0 {
		return path
	}
	return path + "?" + query.Encode()
}

var accountIDPattern = regexp.MustCompile(`^[1-9]\d{0,18}$`)

func accountResource(path, id string) (string, error) {
	if !accountIDPattern.MatchString(id) {
		return "", errors.New("account_id_invalid")
	}
	return path + "/" + id, nil
}

func (c *AccountClient) Analytics(ctx context.Context, query url.Values) (AccountAnalyticsResult, error) {
	var result AccountAnalyticsResult
	err := c.request(ctx, http.MethodGet, accountQuery("/analytics", query), nil, &result)
	return result, err
}
func (c *AccountClient) ListLogs(ctx context.Context, query url.Values) (AccountTaskListResult, error) {
	var result AccountTaskListResult
	err := c.request(ctx, http.MethodGet, accountQuery("/logs", query), nil, &result)
	return result, err
}
func (c *AccountClient) GetLog(ctx context.Context, id string) (AccountTaskDetail, error) {
	var result AccountTaskDetail
	path, err := accountResource("/logs", id)
	if err != nil {
		return result, err
	}
	err = c.request(ctx, http.MethodGet, path, nil, &result)
	return result, err
}
func (c *AccountClient) ListRoutingProfiles(ctx context.Context) ([]AccountRoutingProfileView, error) {
	var result []AccountRoutingProfileView
	err := c.request(ctx, http.MethodGet, "/routing-profiles", nil, &result)
	return result, err
}
func (c *AccountClient) CreateRoutingProfile(ctx context.Context, input AccountCreateRoutingProfile) (AccountRoutingProfileView, error) {
	var result AccountRoutingProfileView
	err := c.request(ctx, http.MethodPost, "/routing-profiles", input, &result)
	return result, err
}
func (c *AccountClient) UpdateRoutingProfile(ctx context.Context, id string, input AccountUpdateRoutingProfile) (AccountRoutingProfileView, error) {
	var result AccountRoutingProfileView
	path, err := accountResource("/routing-profiles", id)
	if err != nil {
		return result, err
	}
	err = c.request(ctx, http.MethodPatch, path, input, &result)
	return result, err
}
func (c *AccountClient) ArchiveRoutingProfile(ctx context.Context, id string) error {
	path, err := accountResource("/routing-profiles", id)
	if err != nil {
		return err
	}
	return c.request(ctx, http.MethodDelete, path, nil, nil)
}
func (c *AccountClient) ListWebhookEndpoints(ctx context.Context) (AccountWebhookEndpointListResult, error) {
	var result AccountWebhookEndpointListResult
	err := c.request(ctx, http.MethodGet, "/webhook-endpoints", nil, &result)
	return result, err
}
func (c *AccountClient) GetWebhookEndpoint(ctx context.Context, id string) (AccountWebhookEndpointView, error) {
	var result AccountWebhookEndpointView
	path, err := accountResource("/webhook-endpoints", id)
	if err != nil {
		return result, err
	}
	err = c.request(ctx, http.MethodGet, path, nil, &result)
	return result, err
}
func (c *AccountClient) CreateWebhookEndpoint(ctx context.Context, input AccountWebhookEndpointCreate) (AccountWebhookEndpointView, error) {
	var result AccountWebhookEndpointView
	err := c.request(ctx, http.MethodPost, "/webhook-endpoints", input, &result)
	return result, err
}
func (c *AccountClient) UpdateWebhookEndpoint(ctx context.Context, id string, input AccountWebhookEndpointUpdate) (AccountWebhookEndpointView, error) {
	var result AccountWebhookEndpointView
	path, err := accountResource("/webhook-endpoints", id)
	if err != nil {
		return result, err
	}
	err = c.request(ctx, http.MethodPatch, path, input, &result)
	return result, err
}
func (c *AccountClient) DeleteWebhookEndpoint(ctx context.Context, id string) error {
	path, err := accountResource("/webhook-endpoints", id)
	if err != nil {
		return err
	}
	return c.request(ctx, http.MethodDelete, path, nil, nil)
}
func (c *AccountClient) ListWebhookDeliveries(ctx context.Context, id string, query url.Values) (AccountWebhookDeliveryListResult, error) {
	var result AccountWebhookDeliveryListResult
	path, err := accountResource("/webhook-endpoints", id)
	if err != nil {
		return result, err
	}
	err = c.request(ctx, http.MethodGet, accountQuery(path+"/deliveries", query), nil, &result)
	return result, err
}
func (c *AccountClient) GetAlerts(ctx context.Context) (AccountUserAlertSetting, error) {
	var result AccountUserAlertSetting
	err := c.request(ctx, http.MethodGet, "/alerts/settings", nil, &result)
	return result, err
}
func (c *AccountClient) UpdateAlerts(ctx context.Context, input AccountUpdateYIRUserAlertSetting) (AccountUserAlertSetting, error) {
	var result AccountUserAlertSetting
	err := c.request(ctx, http.MethodPut, "/alerts/settings", input, &result)
	return result, err
}
func (c *AccountClient) GetLowBalanceAlert(ctx context.Context) (AccountLowBalanceAlertSetting, error) {
	var result AccountLowBalanceAlertSetting
	err := c.request(ctx, http.MethodGet, "/wallet/low-balance-alert", nil, &result)
	return result, err
}
func (c *AccountClient) UpdateLowBalanceAlert(ctx context.Context, input AccountUpdateLowBalanceAlertSetting) (AccountLowBalanceAlertSetting, error) {
	var result AccountLowBalanceAlertSetting
	err := c.request(ctx, http.MethodPut, "/wallet/low-balance-alert", input, &result)
	return result, err
}
