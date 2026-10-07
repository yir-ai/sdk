package yir

import (
	"errors"
	"math"
	"regexp"
	"strings"
)

var quoteAmountPattern = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)

// ErrQuoteCurrencyUnsupported reports a quote priced in a currency other than
// USD. Amounts in another currency must not be compared with USD budgets, so
// the quote is rejected; upgrade the SDK once Yir documents the new currency.
var ErrQuoteCurrencyUnsupported = errors.New("quote_currency_unsupported")

// Validate checks public price semantics without inferring a price from a hold.
// Amounts and currency stay strict; deprecated fields are ignored, and price kinds,
// supply issues, reasons and usage fields newer than this SDK are accepted as data.
func (q Quote) Validate() error {
	invalid := errors.New("quote_response_invalid")
	if q.Object != "quote" || strings.TrimSpace(q.Currency) == "" {
		return invalid
	}
	// Checked first so a quote in another currency is reported as such.
	if q.Currency != "USD" {
		return ErrQuoteCurrencyUnsupported
	}
	if diff := q.PriceDifferencePercent; diff != nil {
		if math.IsNaN(diff.Min) || math.IsInf(diff.Min, 0) || math.IsNaN(diff.Max) || math.IsInf(diff.Max, 0) || diff.Min > diff.Max ||
			(diff.ReferenceAmountMicros != nil && *diff.ReferenceAmountMicros < 0) {
			return invalid
		}
	}
	if q.Model == "" || q.ExpiresAt <= 0 || q.Parameters == nil {
		return invalid
	}
	for _, issue := range q.Supply.Issues {
		if strings.TrimSpace(issue) == "" {
			return invalid
		}
	}
	// Without supply there is nothing to authorize, so no amount may be offered.
	if !q.Supply.Available && (len(q.Supply.Issues) == 0 || q.Primary.Amount != nil || q.ExpectedAmount != nil) {
		return invalid
	}
	if q.ExpectedAmount != nil && !quoteAmountPattern.MatchString(*q.ExpectedAmount) {
		return invalid
	}
	if q.Operation == "" || q.InputMode == "" {
		return invalid
	}
	for _, price := range []QuotePrice{q.Primary, q.Official} {
		switch price.Kind {
		case "fixed":
			if price.Amount == nil || !quoteAmountPattern.MatchString(*price.Amount) || price.Reason != "" || price.Estimate != nil {
				return invalid
			}
		case "estimate":
			if price.Amount == nil || !quoteAmountPattern.MatchString(*price.Amount) || price.Reason != "" || price.Estimate == nil || strings.TrimSpace(price.Estimate.Scope) == "" || !price.Estimate.validUsage() {
				return invalid
			}
		case "unavailable":
			if price.Amount != nil || strings.TrimSpace(price.Reason) == "" || price.Estimate != nil {
				return invalid
			}
		default:
			// A price kind newer than this SDK: the amount must still be a decimal or null.
			if strings.TrimSpace(price.Kind) == "" || price.Amount != nil && !quoteAmountPattern.MatchString(*price.Amount) {
				return invalid
			}
		}
	}
	return nil
}

func (e QuoteEstimate) validUsage() bool {
	if (e.qualitySet || e.Quality != "") && strings.TrimSpace(e.Quality) == "" ||
		(e.aspectRatioSet || e.AspectRatio != "") && strings.TrimSpace(e.AspectRatio) == "" ||
		(e.outputTokensSet && e.OutputTokens <= 0) || (e.outputMegapixelsSet && e.OutputMegapixels <= 0) {
		return false
	}
	// Newer usage metrics may replace these; known ones must still be sane and exclusive.
	return e.OutputTokens >= 0 && e.OutputTokens <= 1_000_000 && e.OutputMegapixels >= 0 && e.OutputMegapixels <= 1_000_000 &&
		!(e.outputTokensSet && e.outputMegapixelsSet)
}
