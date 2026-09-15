package yir

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestResultWarningsHTTPAndWaitCompatibility(t *testing.T) {
	for _, availability := range []string{"available", "expired"} {
		for _, warned := range []bool{false, true} {
			result := map[string]any{"availability": availability}
			if availability == "available" {
				result["files"] = []any{map[string]any{"url": "https://example.com/video.mp4", "media_type": "video/mp4", "expires_at": 1900000000}}
			}
			if warned {
				result["warnings"] = []string{ResultWarningAdditionalResultsUnavailable}
			}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "GET" {
					t.Error("unexpected mutation")
				}
				json.NewEncoder(w).Encode(map[string]any{"object": "job", "id": "1", "status": "succeeded", "result": result, "error": nil})
			}))
			client, err := NewClient("fixture", ClientOptions{BaseURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			for _, wait := range []bool{false, true} {
				var job Job
				if wait {
					job, err = client.WaitJob(context.Background(), "1", WaitOptions{})
				} else {
					job, err = client.GetJob(context.Background(), "1")
				}
				if err != nil || job.Status != "succeeded" || job.Result == nil {
					t.Fatalf("unexpected job: %+v %v", job, err)
				}
				var expected []string
				if warned {
					expected = []string{ResultWarningAdditionalResultsUnavailable}
				}
				if !reflect.DeepEqual(job.Result.Warnings, expected) {
					t.Fatal("warning lost")
				}
				raw, _ := json.Marshal(job.Result)
				var decoded map[string]any
				json.Unmarshal(raw, &decoded)
				if _, exists := decoded["warnings"]; exists != warned {
					t.Fatal("optional warning presence changed")
				}
				if availability == "available" && len(job.Result.Files) != 1 {
					t.Fatal("delivered files changed")
				}
			}
			server.Close()
			if calls != 2 {
				t.Fatalf("unexpected extra polling: %d", calls)
			}
		}
	}
}
