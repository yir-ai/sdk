package yir

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

var demoImageEcho = map[string]any{"aspect_ratio": "16:9", "resolution": "2K", "n": 2, "quality": "auto"}

// demoGateway answers quotes like the Gateway; any other path fails the test.
func demoGateway(t *testing.T, paths *[]string, operation string, parameters map[string]any) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*paths = append(*paths, r.URL.Path)
		if !strings.HasSuffix(r.URL.Path, "/quotes") {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var request GenerationRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"supply": map[string]any{"available": true, "issues": []string{}}, "object": "quote",
			"model": request.Model, "operation": operation, "input_mode": request.Input.Type, "parameters": parameters,
			"currency": "USD", "expires_at": 3000000000, "primary": map[string]any{"kind": "fixed", "amount": "0.04"},
			"official": map[string]any{"kind": "fixed", "amount": "0.08"}})
	}))
	t.Cleanup(server.Close)
	return server
}

func demoClient(t *testing.T, baseURL string, demo *DemoOptions) *Client {
	t.Helper()
	client, err := NewClient("sk-test", ClientOptions{BaseURL: baseURL, Demo: demo})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func demoImageRequest(prompt string) SubmitRequest {
	return SubmitRequest{GenerationRequest: GenerationRequest{Model: "openai/gpt-image-2",
		Input: GenerationInput{Type: "text", Prompt: prompt}, Parameters: map[string]any{"aspect_ratio": "16:9", "n": 2}}}
}

func atDemoTime(t *testing.T, now time.Time) {
	t.Helper()
	previous := demoNow
	demoNow = func() time.Time { return now }
	t.Cleanup(func() { demoNow = previous })
}

func asJSON(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func TestDemoSubmitQuotesAndNeverSubmits(t *testing.T) {
	var paths []string
	server := demoGateway(t, &paths, "generate_image", demoImageEcho)
	client := demoClient(t, server.URL, &DemoOptions{})
	cost := "1.00"
	request := demoImageRequest("A red cup")
	request.MaxCost, request.WebhookURL = &cost, "https://example.com/hook"
	job, err := client.SubmitImage(context.Background(), request, "key-1")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(paths, []string{"/v1/images/quotes"}) {
		t.Fatalf("paths = %v", paths)
	}
	if !IsDemoJobID(job.ID) || !validJobID(job.ID) || job.Status != "queued" || job.Model != "openai/gpt-image-2" ||
		!reflect.DeepEqual(asJSON(t, job.Parameters), asJSON(t, demoImageEcho)) || job.Billing.TotalChargedByYir != "0" || len(job.RawJSON()) == 0 {
		t.Fatalf("job = %+v", job)
	}
	for _, submit := range []func(context.Context, SubmitRequest, ...string) (Job, error){client.SubmitAudio, client.SubmitMusic, client.SubmitVideo} {
		submit(context.Background(), SubmitRequest{GenerationRequest: GenerationRequest{Model: "minimax/music-2.6", Input: GenerationInput{Type: "text", Prompt: "Folk"}}})
	}
	if !reflect.DeepEqual(paths[1:], []string{"/v1/audio/quotes", "/v1/music/quotes", "/v1/videos/quotes"}) {
		t.Fatalf("paths = %v", paths)
	}
}

func TestDemoSubmitErrorsKeepTheIdempotencyKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		io := `{"error":{"code":"YIR_INVALID_REQUEST","message":"bad","retryable":false}}`
		w.Write([]byte(io))
	}))
	defer server.Close()
	_, err := demoClient(t, server.URL, &DemoOptions{}).SubmitImage(context.Background(), demoImageRequest("A cup"), "key-2")
	var submission *SubmissionError
	var apiErr *APIError
	if !errors.As(err, &submission) || submission.IdempotencyKey != "key-2" || !errors.As(err, &apiErr) || apiErr.Code != ErrCodeInvalidRequest {
		t.Fatalf("err = %v", err)
	}

	var paths []string
	rejecting := demoClient(t, demoGateway(t, &paths, "generate_image", demoImageEcho).URL, &DemoOptions{Scenario: DemoScenarioReject})
	_, err = rejecting.SubmitImage(context.Background(), demoImageRequest("A cup"))
	if !errors.As(err, &apiErr) || apiErr.Status != 422 || apiErr.Code != ErrCodeInputRejected || !errors.As(err, &submission) || len(paths) != 1 {
		t.Fatalf("err = %v, paths = %v", err, paths)
	}
	// A prompt marker wins over the option.
	job, err := rejecting.SubmitImage(context.Background(), demoImageRequest("A cup [DEMO:fail]"))
	if err != nil || decodeDemoID(job.ID).scenario != DemoScenarioFail {
		t.Fatalf("job = %+v, err = %v", job, err)
	}
	if _, err := NewClient("sk-test", ClientOptions{Demo: &DemoOptions{Scenario: "boom"}}); err == nil || err.Error() != "demo_scenario_invalid" {
		t.Fatalf("err = %v", err)
	}
}

func TestDemoJobsFollowSharedFixture(t *testing.T) {
	data, err := os.ReadFile("testdata/demo-jobs.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			ID     string          `json:"id"`
			NowMS  int64           `json:"now_ms"`
			Job    json.RawMessage `json:"job"`
			Status json.RawMessage `json:"status"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	// A client without demo mode still answers demo IDs locally.
	client := demoClient(t, "http://127.0.0.1:1", nil)
	for _, item := range fixture.Cases {
		atDemoTime(t, time.UnixMilli(item.NowMS))
		job, err := client.GetJob(context.Background(), item.ID)
		if err != nil {
			t.Fatal(err)
		}
		var want, wantStatus any
		json.Unmarshal(item.Job, &want)
		json.Unmarshal(item.Status, &wantStatus)
		if got := asJSON(t, job); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s at %d:\n got %v\nwant %v", item.ID, item.NowMS, got, want)
		}
		status, err := client.GetJobStatusWithWait(context.Background(), item.ID, 0)
		if err != nil || !reflect.DeepEqual(asJSON(t, status), wantStatus) {
			t.Fatalf("%s status = %+v, err = %v", item.ID, status, err)
		}
	}
}

func TestDemoCancelAndLongPoll(t *testing.T) {
	var paths []string
	client := demoClient(t, demoGateway(t, &paths, "generate_image", demoImageEcho).URL, &DemoOptions{})
	job, err := client.SubmitImage(context.Background(), demoImageRequest("A cup"))
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	status, err := client.GetJobStatusWithWait(context.Background(), job.ID, 5*time.Second)
	if err != nil || status.Status != "running" || time.Since(started) > 4*time.Second {
		t.Fatalf("status = %+v, err = %v after %v", status, err, time.Since(started))
	}
	cancelled, err := client.CancelJob(context.Background(), job.ID)
	if err != nil || cancelled.Status != "cancelled" || cancelled.Cancellation == nil || cancelled.Result != nil {
		t.Fatalf("cancelled = %+v, err = %v", cancelled, err)
	}
	atDemoTime(t, time.Unix(job.CreatedAt+60, 0))
	_, err = client.CancelJob(context.Background(), job.ID)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 409 || apiErr.Code != ErrCodeJobNotCancellable {
		t.Fatalf("err = %v", err)
	}
	done, err := client.WaitJob(context.Background(), job.ID, WaitOptions{})
	if err != nil || done.Status != "succeeded" || len(done.Result.Files) != 2 || done.Result.Files[0].URL != DemoAssetBaseURL+"image/16x9-1.jpg" ||
		done.Result.Files[0].Width != 1280 || done.Result.Files[0].Height != 720 || len(paths) != 1 {
		t.Fatalf("done = %+v, err = %v, paths = %v", done, err, paths)
	}
}

func TestDemoIDLimits(t *testing.T) {
	longest := "spacexai/grok-imagine-video-1.5-lite"
	quote := Quote{Model: longest, Operation: "generate_video", Parameters: map[string]any{"n": 1, "duration": 5}}
	job, err := newDemoJob(quote, DemoScenarioOK, time.Now())
	if err != nil || len(job.ID) > 64 || !validJobID(job.ID) || decodeDemoID(job.ID).model != longest {
		t.Fatalf("job = %+v, err = %v", job, err)
	}
	quote.Model = "vendor/a-model-name-that-is-far-too-long-for-ids"
	if _, err := newDemoJob(quote, DemoScenarioOK, time.Now()); err == nil || err.Error() != "demo_model_id_too_long" {
		t.Fatalf("err = %v", err)
	}
}

func TestDemoBundledFixtureMatchesRepository(t *testing.T) {
	shared, err := os.ReadFile("../spec/fixtures/demo-jobs.json")
	if os.IsNotExist(err) {
		t.Skip("standalone Go module does not contain the repository contract fixtures")
	}
	if err != nil {
		t.Fatal(err)
	}
	bundled, err := os.ReadFile("testdata/demo-jobs.json")
	if err != nil || string(bundled) != string(shared) {
		t.Fatalf("testdata/demo-jobs.json differs from spec/fixtures/demo-jobs.json (err %v)", err)
	}
}

func TestDemoAssetsMatchManifest(t *testing.T) {
	data, err := os.ReadFile("../spec/demo-assets.json")
	if os.IsNotExist(err) {
		t.Skip("standalone Go module does not contain the demo asset manifest")
	}
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		BaseURL string `json:"base_url"`
		Assets  []struct {
			Kind        string `json:"kind"`
			AspectRatio string `json:"aspect_ratio"`
			Variant     int    `json:"variant"`
			Duration    int    `json:"duration"`
			Path        string `json:"path"`
			MediaType   string `json:"media_type"`
			Width       int    `json:"width"`
			Height      int    `json:"height"`
			DurationMS  int64  `json:"duration_ms"`
		} `json:"assets"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.BaseURL != DemoAssetBaseURL || len(manifest.Assets) != len(demoAssets) {
		t.Fatalf("manifest = %s with %d assets", manifest.BaseURL, len(manifest.Assets))
	}
	for index, asset := range manifest.Assets {
		if demoAsset(asset) != demoAssets[index] {
			t.Fatalf("asset %d = %+v, want %+v", index, demoAssets[index], asset)
		}
	}
}
