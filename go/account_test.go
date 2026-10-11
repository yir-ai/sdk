package yir

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestAccountClientBoundary(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer yir_ak_test" {
			t.Error("wrong account authorization")
		}
		if r.URL.Path != "/account/v1/analytics" || r.URL.Query().Get("group_by") != "model" {
			t.Error("wrong account path")
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"code":200,"data":{"summary":{"total_jobs":7}}}`)
	}))
	defer server.Close()
	client, err := NewAccountClient("yir_ak_test", ClientOptions{BaseURL: server.URL + "/account/v1"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Analytics(context.Background(), url.Values{"group_by": {"model"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary == nil || result.Summary.TotalJobs == nil || *result.Summary.TotalJobs != 7 {
		t.Fatal("envelope not decoded")
	}
	if _, err = client.GetLog(context.Background(), "../admin"); err == nil {
		t.Fatal("invalid ID accepted")
	}
	if calls != 1 {
		t.Fatal("invalid request reached network")
	}
	if _, err = NewAccountClient("yir_sk_test", ClientOptions{}); err == nil {
		t.Fatal("gateway key accepted")
	}
}

func TestAccountClientDoesNotRetryWrites(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(503) }))
	defer server.Close()
	client, _ := NewAccountClient("yir_ak_test", ClientOptions{BaseURL: server.URL})
	_, err := client.CreateRoutingProfile(context.Background(), AccountCreateRoutingProfile{Name: "test"})
	if err == nil {
		t.Fatal("expected HTTP failure")
	}
	if calls != 1 {
		t.Fatal("write retried")
	}
}

func TestAccountClientClearsRoutingExclusions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if string(body["excluded_providers"]) != "[]" || string(body["excluded_model_patterns"]) != "[]" {
			t.Error("empty patch arrays were omitted")
		}
		if _, ok := body["allowed_model_patterns"]; ok {
			t.Error("absent patch array was sent")
		}
		io.WriteString(w, `{"code":200,"data":{"id":"123"}}`)
	}))
	defer server.Close()
	client, _ := NewAccountClient("yir_ak_test", ClientOptions{BaseURL: server.URL})
	empty := []string{}
	_, err := client.UpdateRoutingProfile(context.Background(), "123", AccountUpdateRoutingProfile{ExcludedProviders: &empty, ExcludedModelPatterns: &empty})
	if err != nil {
		t.Fatal(err)
	}
}
