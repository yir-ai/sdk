package yir_test

import (
	"context"
	"errors"
	"os"
	"time"

	yir "github.com/yir-ai/sdk/go"
)

type generationClient interface {
	SubmitImage(context.Context, yir.SubmitRequest, ...string) (yir.Job, error)
	SubmitVideo(context.Context, yir.SubmitRequest, ...string) (yir.Job, error)
}

var _ generationClient = (*yir.Client)(nil)

// Compile-checked migration for applications retaining a fixed function type.
func ExampleClient_SubmitImage_legacyFunction() {
	client, err := yir.NewClient("fixture", yir.ClientOptions{})
	if err != nil {
		panic(err)
	}
	var submit func(context.Context, yir.SubmitRequest, string) (yir.Job, error)
	submit = func(ctx context.Context, request yir.SubmitRequest, key string) (yir.Job, error) {
		return client.SubmitImage(ctx, request, key)
	}
	_ = submit // Pass this wrapper to the application's existing function consumer.
}

// This example is compile-checked; without an Output directive, go test does not
// execute it or incur generation costs. Persist the request and key before Submit.
func ExampleClient() {
	client, err := yir.NewClient(os.Getenv("YIR_API_KEY"), yir.ClientOptions{})
	if err != nil {
		panic(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	request := yir.GenerationRequest{
		Model:      "openai/gpt-image-2",
		Input:      yir.GenerationInput{Type: "text", Prompt: "A quiet observatory"},
		Parameters: map[string]any{"resolution": "1K", "aspect_ratio": "1:1", "n": 1},
	}
	quote, err := client.QuoteImage(ctx, request)
	if err != nil {
		panic(err)
	}
	if !quote.Supply.Available || quote.Primary.Amount == nil {
		return
	}
	// Integration requirement: show the estimate in quote.Primary, approve the
	// customer budget as MaxCost and durably save the full SubmitRequest and key
	// below before calling SubmitImage. The Job is charged the upstream amount,
	// capped by MaxCost. This sketch omits application-specific authorization and storage.
	approvedMaxCost := "0.05"
	key := "application-task-123-slot-1"
	job, err := client.SubmitImage(ctx, yir.SubmitRequest{
		GenerationRequest: request, MaxCost: &approvedMaxCost,
	}, key)
	if err != nil {
		// A transport timeout is not proof of failure. Recover with this same key.
		return
	}
	final, err := client.WaitJob(ctx, job.ID, yir.WaitOptions{})
	if err != nil {
		var failed *yir.JobError
		if errors.As(err, &failed) {
			_ = failed.Job.Billing // Apply the terminal customer settlement once.
		}
		// A context timeout only stops local polling; retain job.ID for recovery.
		return
	}
	_ = final.Result // Copy the delivered files into the application's asset store.
}
