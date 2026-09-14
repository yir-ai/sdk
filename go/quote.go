package yir

import (
	"errors"
	"math/big"
	"regexp"
	"strings"
)

var quoteAmountPattern = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)

// Validate checks public price semantics without inferring a price from a hold.
func (q Quote) Validate() error {
	invalid := errors.New("quote_response_invalid")
	if q.Object != "quote" || q.Model == "" || q.Currency != "USD" || q.ExpiresAt <= 0 || q.Parameters == nil {
		return invalid
	}
	if q.Operation != "generate_image" && q.Operation != "generate_video" {
		return invalid
	}
	if q.InputMode != "text" && q.InputMode != "image" && q.InputMode != "reference" {
		return invalid
	}
	for _, price := range []QuotePrice{q.Primary, q.Max, q.Official} {
		switch price.Kind {
		case "fixed":
			if price.Amount == nil || !quoteAmountPattern.MatchString(*price.Amount) || price.Reason != "" || price.Estimate != nil {
				return invalid
			}
		case "estimate":
			if price.Amount == nil || !quoteAmountPattern.MatchString(*price.Amount) || price.Reason != "" || price.Estimate == nil || price.Estimate.Scope != "output_only" || price.Estimate.OutputTokens <= 0 || price.Estimate.OutputTokens > 1_000_000 {
				return invalid
			}
		case "unavailable":
			if price.Amount != nil || strings.TrimSpace(price.Reason) == "" || price.Estimate != nil {
				return invalid
			}
		default:
			return invalid
		}
	}
	if q.Primary.Amount != nil && q.Max.Amount != nil && quoteAmount(*q.Primary.Amount).Cmp(quoteAmount(*q.Max.Amount)) > 0 {
		return invalid
	}
	if q.HasVerifiableUpperBound {
		if q.SingleAttemptUpperBound == nil || !quoteAmountPattern.MatchString(*q.SingleAttemptUpperBound) {
			return invalid
		}
		upper := quoteAmount(*q.SingleAttemptUpperBound)
		for _, price := range []QuotePrice{q.Primary, q.Max} {
			if price.Amount != nil && quoteAmount(*price.Amount).Cmp(upper) > 0 {
				return invalid
			}
		}
	} else if q.SingleAttemptUpperBound != nil {
		return invalid
	}
	return nil
}

func quoteAmount(value string) *big.Rat {
	if !strings.Contains(value, ".") {
		value += ".0"
	}
	amount, _ := new(big.Rat).SetString(value)
	return amount
}
