# Yir Go SDK

> Beta (0.x). Incompatible changes ship only in minor releases, with migration notes in the [changelog](https://github.com/yir-ai/sdk/blob/main/go/CHANGELOG.md). Fields and values newer than the SDK are read as data, so new models and options do not need an SDK release.

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

Server-side image and video API client. Requires Go 1.25+. Module: `github.com/yir-ai/sdk/go`. [MIT](LICENSE).

`parameters.n` is the output count for **one API request (one Job)**. Its allowed values describe that request, not your application’s batch size. For example, a model that only accepts `n=1` can still generate four images through four separate Jobs. Keep application batch controls separate from the model’s `n` parameter; each Job has its own quote, idempotency key, status, and billing.

## Install

Run in your application's Go module:

```sh
go get github.com/yir-ai/sdk/go@latest
```

Module release tags use `go/vX.Y.Z`; this version uses `go/v0.14.0`. The module includes its required test vectors and works without Node or the repository's `spec/` directory.

```go
import (
    "os"
    yir "github.com/yir-ai/sdk/go"
)

// Inside your server function; construction does not make an API request.
client, err := yir.NewClient(os.Getenv("YIR_API_KEY"), yir.ClientOptions{})
if err != nil {
    return err
}
_ = client
```

Keep the key on your server. The default base URL is `https://gateway.yir.ai`; configure `ClientOptions.BaseURL` and `ClientOptions.HTTPClient` if needed. The default HTTP timeout is 30 seconds, and redirects are rejected. If you publish an app that others deploy with their own or their users' keys, set `ClientOptions.ReferralCode` to your Yir referral code; it is sent as `Yir-Referral`, and Jobs count toward your referral rebate once Yir has enabled the code for partner attribution. Otherwise the header is ignored.

## Quick start

Submit, wait, read the result. This is the whole flow and it spends from your balance; [Demo mode](#demo-mode) runs it for free.

```go
request := yir.GenerationRequest{
	Model:      "openai/gpt-image-2",
	Input:      yir.GenerationInput{Type: "text", Prompt: "A quiet observatory"},
	Parameters: map[string]any{"resolution": "1K", "aspect_ratio": "1:1", "n": 1},
}
// The key is yours and stable: the same request and key never create a second Job.
job, err := client.SubmitImage(ctx, yir.SubmitRequest{GenerationRequest: request}, "task-123")
if err != nil {
	return err // yir.SubmissionNotAccepted(err) reports whether no Job was created
}
job, err = client.WaitJob(ctx, job.ID, yir.WaitOptions{})
if err != nil {
	return err // *yir.JobError carries a failed or cancelled Job
}
fmt.Println(job.Result.Files[0].URL, job.Billing.TotalChargedByYir)
```

The result URL is short-lived: copy the file before it expires. To see the price before spending, call `QuoteImage` and read `ExpectedAmount`. The amount you paid is `Billing.TotalChargedByYir` once `Billing.Status` is `settled`. The rest of this page covers recovery, budgets, files and Webhooks.

## Upgrading

Release notes and migration steps for every version are in the [changelog](CHANGELOG.md).

## Quote and submit

`SubmitImage(ctx, request)` and `SubmitVideo(ctx, request)` generate a random idempotency key per call. You may pass one explicit, non-empty key with no CR/LF as the final argument. The built-in transport retries network failures and HTTP 502/503/504 up to three times (0.5s, 1s, 2s backoff), preserving the exact encoded body and idempotency key. Reads use the same policy. Retries share the request timeout and respect cancellation; Retry-After up to 60s is honored, and longer values are returned without retry. Other writes and terminal failed Jobs are never automatically resubmitted. If a submit still fails after an attempt with an unknown outcome (network error, cut-off response or 502/503/504), the error contains `*SubmissionUncertainError` (find it with `errors.As`) even when the last attempt was a 429, 402 or other rejection; it deliberately does not unwrap, so `errors.As(err, &apiErr)` does not match that rejection (read `Err` to inspect it). Check for it before mapping an `*APIError` to "not accepted": the earlier attempt may have created a billed Job, so resubmit the exact request with its `IdempotencyKey` instead of treating it as not accepted. Recovery across calls or process restarts requires a saved key and exact request. Server fallback within an accepted Job is independent of the client key.

Build a `GenerationRequest` with `Model`, `Input` and explicit `Parameters`; use `QuoteImage` or `QuoteVideo`. Require `Supply.Available`. `ExpectedAmount` is the number to show and budget with: what the Job will probably cost on the current first channel, including known input charges. It is absent when there is no reliable estimate; `Primary` (a catalog reference price or an output-only estimate), `Official` and `PriceDifferencePercent` are for price display and comparison. No quote amount is a ceiling. Check expiry before approving new work.

After your application approves the spend, persist the exact `SubmitRequest` and a stable idempotency key. Include routing, references and any `WebhookURL`. `MaxCost` is optional and best left out by default: it guards against runaway charges and is not a price lock (see the warning below). Only then call `SubmitImage(ctx, savedRequest, savedKey)` or `SubmitVideo`. A quote does not authorize or trigger generation. Do not generate a new key on retry; an unknown transport outcome must recover with the original request and key. Never silently replace that request with a new quote or budget.

When a submit fails, `SubmissionNotAccepted(err)` reports whether the error proves that no Job was created and the key is still unused: a request the SDK refused before sending, or a 4xx rejection carrying a Yir error code other than `YIR_IDEMPOTENCY_CONFLICT` and `YIR_JOB_NOT_FOUND` (408 excluded). Only then is it safe to release your own reservation or refund your user. For every other error (`*SubmissionUncertainError`, network errors, 5xx) a Job may exist: resubmit the same request with the same key. The answer covers that call only: if an earlier call with the same key ended with an unknown outcome, that call may have created a Job, and a later rejection does not rule it out.

For music and sound effects, use `QuoteAudio` and `SubmitAudio` (the `/v1/audio` endpoints) with the same lifecycle; `QuoteMusic` / `SubmitMusic` are their original names, call the permanent legacy `/v1/music` paths and behave identically. You can also use a `generate_music` / `generate_sound_effect` item in `QuoteBatch`. For text input, set `Input.Prompt` and, where the model takes custom lyrics, `Input.Lyrics`. Suno models also take a cover (`Input.Type` `"reference"`): exactly one `reference_audio` source song in `Input.References` (URL or File ID, up to 8 minutes) and an `Input.Prompt` describing the new style, with the same lyrics rule and the same price as basic generation; `ValidateGenerationWithCatalog` rejects it for other audio models. In both, `Parameters` are optional and each model accepts only what its contract declares (`n`, `duration`, `instrumental`, `lyrics_optimizer`). Vocal music needs a lyrics source the model supports: `Lyrics`, `lyrics_optimizer: true` (writes lyrics from the prompt; some models add a charge shown in the quote) or `instrumental: true`; these exclude each other. ElevenLabs music takes no lyrics and is priced by `duration` (30–300 s in fixed steps, default 60); ElevenLabs sound effects (`elevenlabs/sound-effects-v2`) take a description, no lyrics and `duration` 1–22 s (default 5), and their quote reports operation `generate_sound_effect`. Suno (`suno/suno-v6`, unofficial access; Suno has no official API) returns two tracks per request (`n` is always 2). The SDK checks shared conflicts before sending; `ValidateGenerationWithCatalog` also checks `n`, `duration` and the lyrics source against the model contract, and the Gateway enforces per-model text limits. Each audio file reports its measured length as `ResultFile.DurationMS`. A music quote echo has no `resolution` or `aspect_ratio`.

Text-to-speech models (`minimax/speech-2.8-hd`, up to 10000 characters; `elevenlabs/eleven-v3`, up to 5000 characters) also use `QuoteAudio` / `SubmitAudio`, or a `generate_speech` item in `QuoteBatch`: `Input.Prompt` is the exact text to read aloud, and `Parameters` take only `n` (1) and `voice`, a preset voice ID of the model (omit it for the model default; the voice does not change the price). There are no lyrics, `instrumental`, `lyrics_optimizer` or `duration`. The quote reports operation `generate_speech`, is priced per character of the prompt (spaces, punctuation and audio tags included) and echoes `n` and `voice`; the Job delivers one MP3 with its measured `ResultFile.DurationMS`.

```go
request := yir.GenerationRequest{Model: "minimax/music-2.6", Input: yir.GenerationInput{
	Type: "text", Prompt: "A warm acoustic folk ballad", Lyrics: "[Verse]\nWalking down a dusty road"}}
quote, err := client.QuoteAudio(ctx, request)
job, err := client.SubmitAudio(ctx, yir.SubmitRequest{GenerationRequest: request}, savedKey)
```

For 3D, use `Quote3D` and `Submit3D` (the `/v1/3d` endpoints) with the same lifecycle, or a `generate_3d` item in `QuoteBatch`. `Input.Type` is `text` (with `Prompt`), `image` (exactly one `reference_image`, empty `Prompt`) or `multiview` (one `front_view` plus at least one of `left_view`, `back_view` and `right_view`, each at most once, empty `Prompt`; only models whose contract lists the multiview input mode). `Parameters` are optional: `texture` (`none`, `standard`, `hd`), `pbr` (needs a texture; `texture: "none"` with `pbr: true` is rejected), `face_limit`, `topology` (`triangle`, `quad`) and `n` (always 1); each model accepts only the values its contract declares, and omitted ones take the model default. `ValidateGenerationWithCatalog("generate_3d", request, catalog)` checks the input mode, references and values against the model contract. The Job delivers one glb file (`model/gltf-binary`) with its measured triangle count in `ResultFile.Faces`; an over-delivered result (textures or PBR maps you did not ask for) is still delivered with a parameter notice. Demo mode has no 3D sample: `Submit3D` returns `ErrDemoOperationUnsupported` without sending.

```go
model := yir.GenerationRequest{Model: "tripo/tripo-p2", Input: yir.GenerationInput{
	Type: "image", References: []yir.Reference{{Role: "reference_image", URL: "https://example.com/chair.png"}}},
	Parameters: map[string]any{"texture": "standard", "pbr": false}}
quote, err := client.Quote3D(ctx, model)
job, err := client.Submit3D(ctx, yir.SubmitRequest{GenerationRequest: model}, savedKey)
```

See [the compile-checked example](client_example_test.go) and its [integration guide](examples/README.md). The example leaves customer authorization and durable storage to the application.

**Warning: a tight `MaxCost` can interrupt delivery during failover.** Even after a Job is accepted, a failed channel may need to be replaced by a more expensive one. If its estimate exceeds the remaining budget after earlier billed attempts, Yir skips it; if no eligible fallback fits, the Job fails with `YIR_BUDGET_EXCEEDED` and may deliver no result. When delivery continuity is more important than a per-Job spending cap, omit this optional field; otherwise leave room for more expensive fallback channels and earlier attempts' charges. Omitting it removes the per-Job cap, so actual charges can exceed the quote; account balance and other limits still apply.

Billing: the balance is not frozen. Every attempt the upstream actually bills is charged at its authoritative upstream amount after the managed discount, including failed attempts and attempts followed by a fallback; attempts the upstream never billed, and Yir's own delivery failures and outcome timeouts, cost nothing. `MaxCost` caps the Job's total charge and skips routes whose estimate exceeds it. The quote's primary price is an estimate, not a ceiling. Prices can change after you quote: a cheaper channel can go offline or cool down, a routing default can change which channels are eligible, or a catalog price can change. Use `MaxCost` as a guard against runaway charges with headroom over the quote, not as a price lock; a cap set to the quote can start failing with `YIR_BUDGET_EXCEEDED` (422 at submit, naming the lowest current estimate, or on the Job). On that error, quote again and let your application decide whether to raise the cap on a new request; do not raise it automatically.

New requests use actual channel bills by default; no billing mode selection is needed. A channel without a reliable estimate may still be available, but cannot accept `max_cost`; choose a channel with an estimate when you need a cap. An unknown price never means free.

## Jobs, files and Webhooks

Persist the returned job ID. `GetJob` queries full job details; `GetJobStatus` queries lightweight `JobStatusResponse` summaries. `WaitJob` long-polls status summaries by default: `GetJobStatusWithWait` lets the Gateway hold a query until the status changes (at most 30 seconds), and `WaitOptions.StatusWait` defaults to `DefaultStatusWait` (20s, kept inside the HTTP client timeout and the context deadline; negative disables), so a terminal Job is seen about a second after Yir records it, without a Webhook. When a Gateway answers without holding, it falls back to the `PollDelay` backoff (5s for the first 30 seconds, 10s until about 90 seconds, then 20s); set `WaitOptions.PollInterval` for a fixed interval. A `429 YIR_RATE_LIMITED` status query (per-API-key requests per minute) is waited out per `Retry-After` (`APIError.RetryAfter`, default 1s, capped at 1 minute), up to 5 times in a row. It reads the full `Job` detail only once at terminal states and rejecting terminal status mismatches with `ErrJobStateInconsistent`. Cancel or time out its context to stop local waiting, which returns a zero-value `Job{}` and does not cancel the remote job or imply a refund. Resume with the saved ID. `JobError` contains the failed/cancelled terminal job; `APIError` contains HTTP status, code, message, retryable and action. Use stable codes for application logic.

`PollJob(ctx, id, wait)` is the single step for applications that schedule their own polling (a durable workflow or job runner): one status query and, once it is terminal, the full `Job` with the same consistency check. It adds no polling loop, backoff schedule or rate-limit wait of its own (the transport's bounded retry of network failures and 502/503/504 still applies), and returns a failed or cancelled Job without an error; a Job still in progress carries only `ID`, `Status`, `Error` and `Cancellation`.

`CancelJob` explicitly requests cancellation and returns the Job's latest state; for a Job that already succeeded or failed it returns that finished Job instead of the Gateway's 409 `YIR_JOB_NOT_CANCELLABLE`. Inspect cancellation status and terminal billing instead of assuming immediate success or zero charge. `Billing.TotalChargedMicros()` returns the total as integer millionths of a dollar. Apply `Billing.TotalChargedByYir` once per job after `Billing.Status` becomes `settled`, including error paths. A terminal result can still have `pending` billing; poll `GetJob` or process the independent `job.billing_settled` webhook. Deduplicate fulfillment and billing settlement separately by Job ID; `ComputeCharges`, `GatewayFee` and `OfficialComparison` explain that total. Compare `APIError.Code` with the `ErrCode*` constants rather than string literals. `APIError.RequestID` carries the `request_id` of a failed HTTP request; include it when contacting Yir support.

`Job`, `JobStatusResponse`, `Quote`, `File` and `ModelDetail` keep the exact JSON they were decoded from: `RawJSON()` returns it, so fields newer than the SDK (including nested ones such as new billing details) can be read with `json.Unmarshal` before a release models them. Values built in code, and values passed through `json.Marshal`, return `nil` or the re-encoded form.

A media reference sets exactly one of `FileID` (a ready File) or `URL` (a public HTTPS URL that Yir imports at submission, up to 100 MiB; data URLs are refused). Use Files for larger media or media that is not publicly reachable. `CompleteFile` may return `processing`; `UploadFile` waits for `ready` with a five-minute default timeout. Resume waiting with `WaitForFileReady` and the saved file ID; a local timeout does not cancel server analysis.

`CreateFiles(ctx, request, key)` creates upload plans. `UploadFile(ctx, plan, source)` uploads from an `io.ReaderAt` and completes the file; `CreateAndUploadFile(ctx, metadata, source, key)` combines the steps. Keep a stable upload key and file IDs. `GetFile` checks state; `CompleteFile` completes a manually uploaded file. Use ready files as generation references with `FileID` and the appropriate role. Single and multipart upload plans are supported. A ready video or audio file reports `DurationSeconds`, its measured length rounded up to the millisecond. Quotes for `FileID` references price input media such as reference video from that measurement; a URL reference has no measured length at quote time, so its quote has no complete price.

`GetFileContentURL(ctx, id)` returns the short-lived signed URL of a ready file. The SDK reads it from the 307 `Location` header and never follows the redirect, so the API key is never sent to storage. Fetch the URL without Gateway credentials and ask again once it expires. Only an absolute `https` URL is accepted. Anything else fails with `file_content_response_invalid`, and errors never include the URL. Missing files return `*APIError` 404 `YIR_FILE_NOT_FOUND`. Files not yet ready return 409 `YIR_FILE_NOT_READY` (wait with `WaitForFileReady`, then retry). Expired files return 410 `YIR_FILE_EXPIRED` (upload them again).

For `POST /v1/files`, a failed upload replay returns non-retryable `400 YIR_INVALID_REQUEST`; create a new upload with a new idempotency key. An expired file returns `410 YIR_FILE_EXPIRED` and also requires a new upload/key. Keep the original key for transient errors (`retryable: true`); do not replace it while planning is in progress.

Set `SubmitRequest.WebhookURL` for callbacks. `VerifyWebhookSignature` takes `Secret`, `ID`, `Timestamp`, `Signature` and `RawBody`. Use the account Webhook secret, not the API key, and exact bytes captured before JSON parsing. Map the delivery's signature metadata into those fields. Default clock tolerance is 300 seconds. Check both the returned error and `Valid`; durably deduplicate by Webhook ID and settle once even when polling also observes the terminal job. `ConstructWebhookEvent` verifies the same fields and returns the Webhook ID and terminal `Job`, or a `*WebhookVerificationError` with a stable `Reason`. Reason `unsupported_event` means the signature is valid but the body is not a terminal Job this SDK understands, such as an event type newer than the SDK; acknowledge it with a 2xx response, log it and deduplicate by its `ID`. Answer other reasons with a 4xx response. Durable workflows that cannot block in `WaitJob` can treat a webhook as a wake-up signal, read the job with `GetJob`, and keep `PollDelay` polling as a fallback.

## Demo mode

Demo mode tests the whole generation flow without spending: set `ClientOptions.Demo` to `&yir.DemoOptions{}` (the Go SDK reads no environment variables; map your own flag to it). Submits run the usual local checks and then the matching quote (free), so the Gateway still validates the parameters, but the request is never submitted. The submit returns a demo Job whose ID starts with `demo_` and carries the quote's model and echoed parameters. Quotes, files, balance and model calls use the Gateway as usual, so an API Key is still required.

A demo Job keeps no state: its ID encodes the creation time, type, aspect ratio, `n`, duration, resolution and scenario, so `GetJob`, `GetJobStatusWithWait` (holding until the next change) and `WaitJob` give the same answer in any process, without a network call, and match the TypeScript SDK. Every `Client` answers `demo_` IDs locally, also with demo mode off; `IsDemoJobID(id)` tells them apart. An image is queued for 2 seconds and succeeds after 8, a video after 25 seconds, audio after 12. The result points at fixed files under `DemoAssetBaseURL` (`https://public.yir.ai/demo/v1/`) with a DEMO badge, picked by type and the nearest aspect ratio (and 5 or 10 second video length); `Width`, `Height` and `DurationMS` describe the actual file, and the requested values stay in `Parameters`. Billing is always `"0"`.

`DemoOptions.Scenario` or a `[demo:<scenario>]` marker in the prompt (which wins) picks the outcome: `DemoScenarioOK` (default); `DemoScenarioSlow`, queued for 6 minutes and succeeded after 8; `DemoScenarioFail`, failed with `YIR_EXECUTION_FAILED` and nothing charged; `DemoScenarioReject`, the submit returns `*APIError` 422 `YIR_INPUT_REJECTED` (inside a `*SubmissionError`) after the quote; `DemoScenarioCancel`, ends `cancelled`. `CancelJob` on an unfinished demo Job returns it `cancelled` and on an ended one returns it as it ended; because nothing is stored, later reads follow the original timeline, so keep the Job `CancelJob` returns.

The submit returns the quote's full `Parameters` echo; later reads of a demo Job keep only `n`, `aspect_ratio`, `resolution` and `duration`, which fit in the ID. Demo mode does not cover idempotent replay of a submit, balance, spend-limit or `MaxCost` admission errors, Webhook delivery, partial or expired results, or fallback billing.

## Pricing and contracts

`GetModel(ctx, "creator/model")` reads the Market `ModelDetail`: `Specifications` with per-channel `Channels` display prices (`AmountMicros` is `nil` when no price is published) and optional `ChannelParameters`. Pass the canonical ID; aliases are not resource paths, and an invalid ID fails locally with `model_request_invalid`. The SDK ignores unknown fields and accepts operations, input modes, currencies, availability values and rule behaviors newer than the SDK, but rejects a mismatched ID or missing/empty required values with `model_response_invalid`. A missing model returns `*APIError` 404 `YIR_MODEL_NOT_FOUND`. Market prices are for display only; use a quote before submitting. `GetModelContract` remains the versioned parameter contract (`view=contract`).

Submission and quote clients perform protocol checks and let the Gateway validate model parameters, even with `ClientOptions.ModelContracts`. A stale catalog must not reject newly supported parameter values. `ValidateGenerationWithCatalog` remains explicitly strict; use it when you deliberately want to restrict requests to a catalog snapshot.

Failed submit calls return `*SubmissionError` with `IdempotencyKey`; use `errors.As` to retrieve it and recover with the exact original request. `Unwrap` preserves the transport/API error. Persist a caller-generated key before submission for crash recovery. `client.GetBalance(ctx)` reads a wallet snapshot in USD decimal strings; available and total amounts can be negative after settlement. Reading balance is optional and does not authorize or gate submission.

## Verify

From this directory, run `go test -p 2 ./...` with `GOWORK=off` and `GOMAXPROCS=2` for isolated module verification. Examples without an `Output` directive are compiled but not executed. Optional external price-fixture tests skip when their input is absent. No Node installation is needed.

New requests should omit `billing_mode`. Retrying a persisted request must keep the original body and idempotency key, including legacy `billing_mode`. Treat absent or unknown billing status as unconfirmed; do not infer settlement from a zero charge.
