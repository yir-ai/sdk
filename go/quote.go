package yir

import (
	"errors"
	"math"
	"math/big"
	"regexp"
	"strings"
)

var quoteAmountPattern = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)

// Validate checks public price semantics without inferring a price from a hold.
func (q Quote) Validate() error {
	invalid := errors.New("quote_response_invalid")
	if diff := q.PriceDifferencePercent; diff != nil {
		if math.IsNaN(diff.Min) || math.IsInf(diff.Min, 0) || math.IsNaN(diff.Max) || math.IsInf(diff.Max, 0) || diff.Min > diff.Max ||
			(diff.ReferenceAmountMicros != nil && *diff.ReferenceAmountMicros < 0) {
			return invalid
		}
	}
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
			if price.Amount == nil || !quoteAmountPattern.MatchString(*price.Amount) || price.Reason != "" || price.Estimate == nil || price.Estimate.Scope != "output_only" || !price.Estimate.validUsage() {
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

func (e QuoteEstimate) validUsage() bool {
	if (e.qualitySet || e.Quality != "") && strings.TrimSpace(e.Quality) == "" ||
		(e.aspectRatioSet || e.AspectRatio != "") && strings.TrimSpace(e.AspectRatio) == "" ||
		(e.outputTokensSet && e.OutputTokens <= 0) || (e.outputMegapixelsSet && e.OutputMegapixels <= 0) {
		return false
	}
	return (e.OutputTokens > 0 && e.OutputTokens <= 1_000_000 && e.OutputMegapixels == 0 && !e.outputMegapixelsSet) ||
		(e.OutputMegapixels > 0 && e.OutputMegapixels <= 1_000_000 && e.OutputTokens == 0 && !e.outputTokensSet)
}

func quoteAmount(value string) *big.Rat {
	if !strings.Contains(value, ".") {
		value += ".0"
	}
	amount, _ := new(big.Rat).SetString(value)
	return amount
}
