package yir_test

import (
	"context"
	"errors"
	"os"
	"time"

	yir "github.com/yir-ai/sdk/go"
)

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
	if !quote.HasVerifiableUpperBound {
		return
	}
	// Persist this key and request in the application's task record.
	key := "application-task-123-slot-1"
	job, err := client.SubmitImage(ctx, yir.SubmitRequest{
		GenerationRequest: request, MaxCost: quote.SingleAttemptUpperBound,
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
