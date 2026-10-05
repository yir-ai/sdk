package yir

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQuotePriceDifferenceMetadata(t *testing.T) {
	var q Quote
	if err := json.Unmarshal([]byte(`{"object":"quote","supply":{"available":true,"requires_max_cost":true,"issues":[]},"model":"future/image","operation":"generate_image","input_mode":"text","parameters":{},"currency":"USD","expires_at":1,"primary":{"kind":"fixed","amount":"0.02"},"max":{"kind":"fixed","amount":"0.05"},"official":{"kind":"unavailable","reason":"missing"},"price_difference_percent":{"min":-10,"max":20,"reference_amount_micros":50000}}`), &q); err != nil {
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
		Supply:   QuoteSupply{Available: true},
		Primary:  QuotePrice{Kind: "unavailable", Reason: "missing"},
		Official: QuotePrice{Kind: "estimate", Amount: fixedQuotePrice("0.042390").Amount, Estimate: &QuoteEstimate{Scope: "output_only", OutputTokens: 1413}}}
	if err := q.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, assumption := range []*QuoteEstimate{nil, {OutputTokens: 1413}, {Scope: "output_only", OutputTokens: -1}, {Scope: "output_only", OutputTokens: 1_000_001}} {
		q.Official.Estimate = assumption
		if q.Validate() == nil {
			t.Fatal("invalid estimate accepted")
		}
	}
	var newer QuotePrice
	if err := json.Unmarshal([]byte(`{"kind":"estimate","amount":"0.04","estimate":{"scope":"complete","output_seconds":8}}`), &newer); err != nil {
		t.Fatal(err)
	}
	q.Official = newer
	if err := q.Validate(); err != nil {
		t.Fatalf("newer estimate scope rejected: %v", err)
	}
	if err := json.Unmarshal([]byte(`{"kind":"estimate","amount":"0.04","estimate":{"scope":"output_only","output_tokens":0}}`), &newer); err != nil {
		t.Fatal(err)
	}
	q.Official = newer
	if q.Validate() == nil {
		t.Fatal("zero usage accepted")
	}
}

func TestQuoteValidatesUnavailableAndExactAmounts(t *testing.T) {
	base := Quote{Object: "quote", Model: "openai/gpt-image-2", Operation: "generate_image", InputMode: "text", Parameters: map[string]any{}, Currency: "USD", ExpiresAt: 1,
		Supply:  QuoteSupply{Available: true},
		Primary: fixedQuotePrice("0.02"), Official: QuotePrice{Kind: "unavailable", Reason: "missing"}}
	if err := base.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Quote){
		func(q *Quote) { q.Primary.Amount = nil },
		func(q *Quote) { q.Primary = fixedQuotePrice("1e-2") },
		func(q *Quote) { q.Official.Amount = fixedQuotePrice("0").Amount },
		func(q *Quote) { q.Official.Reason = "" },
		func(q *Quote) { q.Currency = "CNY" },
	} {
		q := base
		change(&q)
		if err := q.Validate(); err == nil {
			t.Fatal("invalid quote accepted")
		}
	}
	unknown := base
	unknown.Primary = QuotePrice{Kind: "unavailable", Reason: "missing"}
	if err := unknown.Validate(); err != nil {
		t.Fatal(err)
	}
}

// The Gateway still returns deprecated compatibility fields; this SDK ignores them.
func TestQuoteIgnoresDeprecatedCompatibilityFields(t *testing.T) {
	var q Quote
	if err := json.Unmarshal([]byte(`{"object":"quote","supply":{"available":true,"requires_max_cost":false,"issues":[]},"model":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","parameters":{},"currency":"USD","expires_at":1,"primary":{"kind":"fixed","amount":"0.02"},"max":{"kind":"fixed","amount":"0.02"},"official":{"kind":"fixed","amount":"0.04"},"has_verifiable_upper_bound":false,"single_attempt_upper_bound":null}`), &q); err != nil {
		t.Fatal(err)
	}
	if err := q.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestQuoteSupplyConsistency(t *testing.T) {
	base := Quote{Object: "quote", Model: "openai/gpt-image-2", Operation: "generate_image", InputMode: "text",
		Parameters: map[string]any{}, Currency: "USD", ExpiresAt: 1,
		Supply: QuoteSupply{Available: true}, Primary: fixedQuotePrice("0.02"),
		Official: QuotePrice{Kind: "unavailable", Reason: "official_price_unavailable"}}
	noSupply := QuotePrice{Kind: "unavailable", Reason: "no_matching_supply"}
	for _, tc := range []struct {
		name   string
		change func(*Quote)
		valid  bool
	}{
		{"available priced", func(q *Quote) {}, true},
		// Issue names and price kinds are server data; amounts stay strict.
		{"available with advisory issue", func(q *Quote) { q.Supply.Issues = []string{"slow_supply"} }, true},
		{"blank issue", func(q *Quote) { q.Supply.Issues = []string{" "} }, false},
		{"newer price kind", func(q *Quote) { q.Official = QuotePrice{Kind: "tiered", Amount: fixedQuotePrice("0.03").Amount} }, true},
		{"newer price kind bad amount", func(q *Quote) { q.Official = QuotePrice{Kind: "tiered", Amount: fixedQuotePrice("1e-2").Amount} }, false},
		{"unavailable priced", func(q *Quote) { q.Supply = QuoteSupply{Issues: []string{"no_matching_supply"}} }, false},
		{"unavailable without issue", func(q *Quote) {
			q.Supply = QuoteSupply{}
			q.Primary = noSupply
		}, false},
		{"unavailable newer issue", func(q *Quote) {
			q.Supply = QuoteSupply{Issues: []string{"region_restricted"}}
			q.Primary = QuotePrice{Kind: "unavailable", Reason: "region_restricted"}
		}, true},
		{"unavailable consistent", func(q *Quote) {
			q.Supply = QuoteSupply{Issues: []string{"no_matching_supply"}}
			q.Primary = noSupply
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q := base
			tc.change(&q)
			if err := q.Validate(); (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}

// A quote in another currency fails closed with its own error so callers can
// tell it apart from a malformed response.
func TestQuoteReportsUnsupportedCurrency(t *testing.T) {
	q := Quote{Object: "quote", Currency: "EUR"}
	if err := q.Validate(); !errors.Is(err, ErrQuoteCurrencyUnsupported) {
		t.Fatalf("EUR: %v", err)
	}
	for _, currency := range []string{"", " "} {
		q.Currency = currency
		if err := q.Validate(); err == nil || err.Error() != "quote_response_invalid" {
			t.Fatalf("%q: %v", currency, err)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		quote := `{"object":"quote","supply":{"available":true,"requires_max_cost":false,"issues":[]},"model":"openai/gpt-image-2","operation":"generate_image","input_mode":"text","parameters":{},"currency":"EUR","expires_at":3000000000,"has_verifiable_upper_bound":true,"single_attempt_upper_bound":"0.05","primary":{"kind":"fixed","amount":"0.02"},"max":{"kind":"fixed","amount":"0.05"},"official":{"kind":"unavailable","amount":null,"reason":"official_price_unavailable"}}`
		if r.URL.Path == "/v1/quotes" {
			quote = `{"object":"quote_batch","request_id":"test","data":[{"index":0,"quote":` + quote + `}]}`
		}
		io.WriteString(w, quote)
	}))
	defer server.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if _, err := client.QuoteImage(context.Background(), imageRequest()); !errors.Is(err, ErrQuoteCurrencyUnsupported) {
		t.Fatalf("QuoteImage: %v", err)
	}
	if _, err := client.QuoteBatch(context.Background(), []QuoteBatchRequestItem{{Operation: "generate_image", Request: imageRequest()}}); !errors.Is(err, ErrQuoteCurrencyUnsupported) {
		t.Fatalf("QuoteBatch: %v", err)
	}
}
