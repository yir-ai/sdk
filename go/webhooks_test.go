package yir

import (
	"bytes"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
)

func webhookVector(t *testing.T) VerifyWebhookSignatureRequest {
	t.Helper()
	raw, err := os.ReadFile("testdata/yir-standard-webhook-signature-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Secret    string `json:"testOnlySecret"`
		ID        string `json:"id"`
		Timestamp string `json:"timestamp"`
		Signature string `json:"signature"`
		RawBody   string `json:"rawBody"`
	}
	if err := json.Unmarshal(raw, &vector); err != nil {
		t.Fatal(err)
	}
	now, err := strconv.ParseInt(vector.Timestamp, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return VerifyWebhookSignatureRequest{Secret: vector.Secret, ID: vector.ID, Timestamp: vector.Timestamp, Signature: vector.Signature, RawBody: []byte(vector.RawBody), Now: &now}
}

func TestWebhookBundledVectorMatchesRepository(t *testing.T) {
	shared, err := os.ReadFile("../spec/fixtures/contracts/yir-standard-webhook-signature-v1.json")
	if os.IsNotExist(err) {
		t.Skip("standalone Go module does not contain the repository contract fixtures")
	}
	if err != nil {
		t.Fatal(err)
	}
	bundled, err := os.ReadFile("testdata/yir-standard-webhook-signature-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual bytes.Buffer
	if err := json.Compact(&expected, shared); err != nil {
		t.Fatal(err)
	}
	if err := json.Compact(&actual, bundled); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(expected.Bytes(), actual.Bytes()) {
		t.Fatal("bundled webhook fixture differs from the shared contract")
	}
}

func TestWebhookSharedSignatureVector(t *testing.T) {
	r := webhookVector(t)
	result, err := VerifyWebhookSignature(r)
	if err != nil || !result.Valid || result.Timestamp != *r.Now {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	for _, offset := range []int64{-300, 300} {
		now := *r.Now + offset
		r.Now = &now
		result, err := VerifyWebhookSignature(r)
		if err != nil || !result.Valid {
			t.Fatal("tolerance boundary rejected")
		}
		r = webhookVector(t)
	}
}

func TestWebhookRejectsTamperingAndInvalidHeaders(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*VerifyWebhookSignatureRequest)
		reason string
	}{
		{"body", func(r *VerifyWebhookSignatureRequest) { r.RawBody = append(r.RawBody, ' ') }, "invalid_signature"},
		{"id", func(r *VerifyWebhookSignatureRequest) { r.ID += "-different" }, "invalid_signature"},
		{"secret", func(r *VerifyWebhookSignatureRequest) { r.Secret = "yir_whsec_" + strings.Repeat("B", 43) }, "invalid_signature"},
		{"wrong secret format", func(r *VerifyWebhookSignatureRequest) { r.Secret = "api-key" }, "invalid_secret"},
		{"missing header", func(r *VerifyWebhookSignatureRequest) { r.Signature = "" }, "missing_header"},
		{"signature", func(r *VerifyWebhookSignatureRequest) { r.Signature = "v1=invalid" }, "invalid_signature"},
		{"expired", func(r *VerifyWebhookSignatureRequest) { *r.Now += 301 }, "timestamp_outside_tolerance"},
		{"future", func(r *VerifyWebhookSignatureRequest) { *r.Now -= 301 }, "timestamp_outside_tolerance"},
		{"fraction", func(r *VerifyWebhookSignatureRequest) { r.Timestamp += ".0" }, "invalid_timestamp"},
		{"leading zero", func(r *VerifyWebhookSignatureRequest) { r.Timestamp = "0" + r.Timestamp }, "invalid_timestamp"},
		{"overflow", func(r *VerifyWebhookSignatureRequest) { r.Timestamp = "9007199254740992" }, "invalid_timestamp"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := webhookVector(t)
			tc.mutate(&r)
			result, err := VerifyWebhookSignature(r)
			if err != nil || result.Valid || result.Reason != tc.reason {
				t.Fatalf("result=%+v error=%v", result, err)
			}
		})
	}
}

func TestWebhookRejectsInvalidClockConfiguration(t *testing.T) {
	r := webhookVector(t)
	negative := int64(-1)
	r.ToleranceSeconds = &negative
	if _, err := VerifyWebhookSignature(r); err == nil {
		t.Fatal("negative tolerance accepted")
	}
	r.ToleranceSeconds = nil
	r.Now = &negative
	if _, err := VerifyWebhookSignature(r); err == nil {
		t.Fatal("negative time accepted")
	}
}
