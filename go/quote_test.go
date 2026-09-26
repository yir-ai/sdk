package yir

import (
	"encoding/json"
	"math"
	"testing"
)

func TestQuotePriceDifferenceMetadata(t *testing.T) {
	var q Quote
	if err := json.Unmarshal([]byte(`{"object":"quote","model":"future/image","operation":"generate_image","input_mode":"text","parameters":{},"currency":"USD","expires_at":1,"primary":{"kind":"fixed","amount":"0.02"},"max":{"kind":"fixed","amount":"0.05"},"official":{"kind":"unavailable","reason":"missing"},"price_difference_percent":{"min":-10,"max":20,"reference_amount_micros":50000}}`), &q); err != nil {
		t.Fatal(err)
	}
	if q.PriceDifferencePercent == nil || q.PriceDifferencePercent.Min != -10 || q.PriceDifferencePercent.ReferenceAmountMicros == nil || *q.PriceDifferencePercent.ReferenceAmountMicros != 50000 {
		t.Fatal("comparison metadata lost")
	}
	if err := q.Validate(); err != nil {
		t.Fatal(err)
	}
	negative := int64(-1)
	for _, diff := range []QuotePriceDifference{{Min: 2, Max: 1}, {Min: math.NaN()}, {Max: math.Inf(1)}, {ReferenceAmountMicros: &negative}} {
		q.PriceDifferencePercent = &diff
		if q.Validate() == nil {
			t.Fatal("invalid comparison accepted")
		}
	}
}

func fixedQuotePrice(amount string) QuotePrice { return QuotePrice{Kind: "fixed", Amount: &amount} }

func TestQuoteOutputEstimateDoesNotRequireOrCreateBudget(t *testing.T) {
	q := Quote{Object: "quote", Model: "openai/gpt-image-2", Operation: "generate_image", InputMode: "text", Parameters: map[string]any{}, Currency: "USD", ExpiresAt: 1,
		Primary: QuotePrice{Kind: "unavailable", Reason: "missing"}, Max: QuotePrice{Kind: "unavailable", Reason: "missing"},
		Official: QuotePrice{Kind: "estimate", Amount: fixedQuotePrice("0.042390").Amount, Estimate: &QuoteEstimate{Scope: "output_only", OutputTokens: 1413}}}
	if err := q.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, assumption := range []*QuoteEstimate{nil, {Scope: "complete", OutputTokens: 1413}, {Scope: "output_only", OutputTokens: 0}, {Scope: "output_only", OutputTokens: 1_000_001}} {
		q.Official.Estimate = assumption
		if q.Validate() == nil {
			t.Fatal("invalid estimate accepted")
		}
	}
}

func TestQuoteValidatesUnavailableAndExactAmounts(t *testing.T) {
	base := Quote{Object: "quote", Model: "openai/gpt-image-2", Operation: "generate_image", InputMode: "text", Parameters: map[string]any{}, Currency: "USD", ExpiresAt: 1,
		Primary: fixedQuotePrice("0.02"), Max: fixedQuotePrice("0.05"), Official: QuotePrice{Kind: "unavailable", Reason: "missing"}, HasVerifiableUpperBound: true, SingleAttemptUpperBound: fixedQuotePrice("0.05").Amount}
	if err := base.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Quote){
		func(q *Quote) { q.Primary.Amount = nil },
		func(q *Quote) { q.Official.Amount = fixedQuotePrice("0").Amount },
		func(q *Quote) { q.Official.Reason = "" },
		func(q *Quote) { q.Max = fixedQuotePrice("0.01") },
		func(q *Quote) { q.SingleAttemptUpperBound = fixedQuotePrice("0.04").Amount },
		func(q *Quote) { q.Currency = "CNY" },
		func(q *Quote) { q.HasVerifiableUpperBound = false },
		func(q *Quote) {
			q.Primary = fixedQuotePrice("1000000000000.000002")
			q.Max = fixedQuotePrice("1000000000000.000001")
			q.SingleAttemptUpperBound = fixedQuotePrice("1000000000001").Amount
		},
	} {
		q := base
		change(&q)
		if err := q.Validate(); err == nil {
			t.Fatal("invalid quote accepted")
		}
	}
	unknown := base
	unknown.Primary = QuotePrice{Kind: "unavailable", Reason: "missing"}
	unknown.Max = unknown.Primary
	unknown.SingleAttemptUpperBound = nil
	unknown.HasVerifiableUpperBound = false
	if err := unknown.Validate(); err != nil {
		t.Fatal(err)
	}
}
