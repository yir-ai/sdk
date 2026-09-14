package yir

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"regexp"
	"strconv"
	"time"
)

var webhookSecretPattern = regexp.MustCompile(`^yir_whsec_[A-Za-z0-9_-]{43}$`)
var webhookSignaturePattern = regexp.MustCompile(`^v1=[A-Za-z0-9+/]{43}=$`)
var webhookTimestampPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

type VerifyWebhookSignatureRequest struct {
	Secret    string
	ID        string
	Timestamp string
	Signature string
	// RawBody must contain the original bytes, before parsing or re-encoding JSON.
	RawBody []byte
	// Nil uses the current UTC time and the default five-minute tolerance.
	Now              *int64
	ToleranceSeconds *int64
}

type WebhookVerificationResult struct {
	Valid     bool
	Timestamp int64
	Reason    string
}

// VerifyWebhookSignature authenticates the raw request; deduplication by webhook
// ID and applying the Job settlement once remain the receiver's responsibility.
func VerifyWebhookSignature(request VerifyWebhookSignatureRequest) (WebhookVerificationResult, error) {
	fail := func(reason string) (WebhookVerificationResult, error) {
		return WebhookVerificationResult{Reason: reason}, nil
	}
	if !webhookSecretPattern.MatchString(request.Secret) {
		return fail("invalid_secret")
	}
	if request.ID == "" || request.Timestamp == "" || request.Signature == "" {
		return fail("missing_header")
	}
	const maxSafeInteger int64 = 9007199254740991
	timestamp, err := strconv.ParseInt(request.Timestamp, 10, 64)
	if err != nil || !webhookTimestampPattern.MatchString(request.Timestamp) || timestamp > maxSafeInteger {
		return fail("invalid_timestamp")
	}
	tolerance := int64(300)
	if request.ToleranceSeconds != nil {
		tolerance = *request.ToleranceSeconds
	}
	if tolerance < 0 || tolerance > maxSafeInteger {
		return WebhookVerificationResult{}, errors.New("webhook_tolerance_invalid")
	}
	now := time.Now().Unix()
	if request.Now != nil {
		now = *request.Now
	}
	if now < 0 || now > maxSafeInteger {
		return WebhookVerificationResult{}, errors.New("webhook_clock_invalid")
	}
	difference := now - timestamp
	if difference < 0 {
		difference = -difference
	}
	if difference > tolerance {
		return fail("timestamp_outside_tolerance")
	}
	if !webhookSignaturePattern.MatchString(request.Signature) {
		return fail("invalid_signature")
	}
	mac := hmac.New(sha256.New, []byte(request.Secret))
	mac.Write([]byte(request.Timestamp + "." + request.ID + "."))
	mac.Write(request.RawBody)
	expected := "v1=" + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(request.Signature)) {
		return fail("invalid_signature")
	}
	return WebhookVerificationResult{Valid: true, Timestamp: timestamp}, nil
}
