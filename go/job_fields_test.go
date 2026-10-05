package yir

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestJobDecodesRoutingUsageAndBillingFacts(t *testing.T) {
	raw := `{"id":"7","object":"job","final_provider":"openai","status":"succeeded","model":"openai/gpt-image-2",
		"parameters":{"resolution":"1K","aspect_ratio":"1:1","n":1},
		"urls":{"get":"/v1/jobs/7","cancel":"/v1/jobs/7/cancel"},"usage":{"outputs":2},"error":null,"created_at":1,
		"billing":{"currency":"USD","total_charged_by_yir":"0.05","max_cost":"0.10",
			"compute_charges":[{"supply_type":"managed","billed_by":"yir","amount":"0.04","amount_basis":"yir_price_rule","status":"settled",
				"usage":[{"metric":"output_images","quantity":"2","unit":"image"}]}],
			"gateway_fee":{"amount":"0.01","status":"settled"},
			"official_comparison":{"baseline_amount":"0.08","savings_amount":"0.03","source_url":"https://example.com/pricing"}}}`
	var job Job
	if err := json.Unmarshal([]byte(raw), &job); err != nil {
		t.Fatal(err)
	}
	if job.FinalProvider != "openai" || job.URLs == nil || job.URLs.Cancel != "/v1/jobs/7/cancel" || job.Usage == nil || job.Usage.Outputs != 2 {
		t.Fatalf("routing or usage lost: %+v", job)
	}
	if job.Parameters["resolution"] != "1K" || job.Parameters["n"] != float64(1) || job.Parameters["duration"] != nil {
		t.Fatalf("parameters echo lost: %+v", job.Parameters)
	}
	billing := job.Billing
	if billing == nil || len(billing.ComputeCharges) != 1 || billing.GatewayFee.Amount != "0.01" {
		t.Fatalf("billing lost: %+v", billing)
	}
	managed := billing.ComputeCharges[0]
	if managed.Amount != "0.04" || len(managed.Usage) != 1 || managed.Usage[0].Quantity != "2" {
		t.Fatalf("managed charge lost: %+v", managed)
	}
	if billing.OfficialComparison == nil || billing.OfficialComparison.SourceURL == "" {
		t.Fatalf("official comparison lost: %+v", billing)
	}
}

func TestUserAgentReportsVersion(t *testing.T) {
	var got string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("User-Agent")
		io.WriteString(w, `{"id":"7","status":"running","error":null}`)
	}))
	defer server.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetJobStatus(context.Background(), "7"); err != nil {
		t.Fatal(err)
	}
	if got != "yir-go/"+Version {
		t.Fatalf("User-Agent = %q", got)
	}
}
