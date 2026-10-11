package yir

import (
	"context"
	"errors"
	"net/http"
	"regexp"
)

// Balance is a wallet snapshot, not a quote or a spending authorization.
// AvailableAmount and TotalAmount may be negative when actual billing creates debt.
type Balance struct {
	Object          string `json:"object"`
	Currency        string `json:"currency"`
	AvailableAmount string `json:"available_amount"`
	HeldAmount      string `json:"held_amount"`
	TotalAmount     string `json:"total_amount"`
}

var balanceAmountPattern = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$`)

func (c *Client) GetBalance(ctx context.Context) (Balance, error) {
	var balance Balance
	if err := c.do(ctx, http.MethodGet, "/v1/balance", "", nil, &balance); err != nil {
		return balance, err
	}
	if balance.Object != "balance" || balance.Currency != "USD" ||
		!balanceAmountPattern.MatchString(balance.AvailableAmount) ||
		!balanceAmountPattern.MatchString(balance.TotalAmount) ||
		!balanceAmountPattern.MatchString(balance.HeldAmount) || balance.HeldAmount[0] == '-' {
		return Balance{}, errors.New("balance_response_invalid")
	}
	return balance, nil
}
