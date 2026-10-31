# Yir Go SDK

> Beta (0.x). Incompatible changes ship only in minor releases, with migration notes in the README and [changelog](https://github.com/yir-ai/sdk/blob/main/go/CHANGELOG.md). Fields and values newer than the SDK are read as data, so new models and options do not need an SDK release.

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

Server-side image and video API client. Requires Go 1.25+. Module: `github.com/yir-ai/sdk/go`. [MIT](LICENSE).

`parameters.n` is the output count for **one API request (one Job)**. Its allowed values describe that request, not your application’s batch size. For example, a model that only accepts `n=1` can still generate four images through four separate Jobs. Keep application batch controls separate from the model’s `n` parameter; each Job has its own quote, idempotency key, status, and billing.

## Install

Run in your application's Go module:

```sh
go get github.com/yir-ai/sdk/go@latest
```

Module release tags use `go/vX.Y.Z`; this version uses `go/v0.13.0`. The module includes its required test vectors and works without Node or the repository's `spec/` directory.

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

## Upgrading to 0.13.0

0.13.0 is a minor release and is compatible with 0.12.0. The Gateway features it relies on are already live.

Additions:

- Demo mode: `ClientOptions.Demo` (`DemoOptions`, `DemoScenario*`), `IsDemoJobID` and `DemoAssetBaseURL`. Every `Client` answers `demo_` Job IDs locally. See [Demo mode](#demo-mode).
- `QuoteAudio` / `SubmitAudio` for the `/v1/audio` endpoints (music, sound effects and text-to-speech; `QuoteMusic` / `SubmitMusic` stay as aliases), the `voice` parameter, and `generate_sound_effect` / `generate_speech` quotes and `QuoteBatch` items.
- Reference role `keyframe` for ordered middle frames; subject references with mixed subjects, subject voices and video subjects in model contracts and `ValidateGenerationWithCatalog`.
- Parameter notice disposition `exceeded` for over-delivered results.

## Upgrading to 0.12.0

0.12.0 is a minor release with incompatible behavior changes; the exported API only gains additions. 0.11.2 was never published on its own; its [changes](#0112-changes) ship with this release. The Gateway features it relies on are already live.

Incompatible changes:

- Quote and submit no longer validate model parameters against `ClientOptions.ModelContracts`. They check the protocol skeleton and let the Gateway validate, so an invalid parameter returns `*APIError` with `ErrCodeInvalidRequest` (fields in `Details`) instead of a local `*ParameterError`. Call `ValidateGenerationWithCatalog` when you want strict local checks.
- A failed submit returns `*SubmissionError`, which carries the `IdempotencyKey` and wraps the transport or API error. Reach the `*APIError` with `errors.As`; a direct type assertion on the returned error no longer matches.
- `HTTPClient.Timeout` (30 seconds by default) bounds the whole call, including the transport retries below.
- A legacy `BillingMode: "actual"` request no longer requires `Routing.Only`.

Additions:

- Network failures and HTTP 502/503/504 are retried up to three times for reads and for generation submits with a key, with the same body and idempotency key; a `Retry-After` of up to one minute is honored. `WaitJob` keeps waiting for an accepted Job through Gateway outages and waits out `429 YIR_RATE_LIMITED` (`APIError.RetryAfter`).
- `QuoteAudio` and `SubmitAudio` (originally `QuoteMusic` / `SubmitMusic`), `GenerationInput.Lyrics` and `ResultFile.DurationMS`; see [Quote and submit](#quote-and-submit).
- `ClientOptions.ReferralCode`, sent as `Yir-Referral`.
- `client.GetBalance`, and `NewAccountClient` for the Account API, including routing profile `ExcludedModelProviders`.
- `Routing.Fidelity` (`RoutingFidelity*`, `ErrCodeFidelityExcluded`), `Routing.Accelerate`, and per-file `ResultFile.Fidelity`.
- `APIError.ProviderError`, `ErrCodeInputRejected` and `JobBilling.Status` (`pending` or `settled`).
- Model contracts carry `StringValues` (such as Seedance 2.5 duration `"auto"`, kept in quote and Job parameter echoes) and `PromptOptional`. Market specifications with no listed channels are kept.

## 0.11.2 changes

0.11.2 is a compatible release:

- `Quote.ExpectedAmount` (`*string`, optional) is the first channel's admission estimate: the amount Yir checks your balance, API Key monthly limit and `max_cost` against. Unlike an output-only `estimate` price it includes known input charges such as reference images and, for usage-billed channels, recent actual charges. It is absent when no channel matches or a reliable estimate is unavailable. `Validate` requires a decimal and rejects it without supply. Prefer it over `Primary.Amount` as a cost reference; it is not a ceiling.

## 0.11.1 changes

0.11.1 is a compatible release that follows the Gateway's parameter echo and catalog caching changes:

- `Quote.Parameters` echoes exactly the parameters the model contract declares, at contract spelling and with omitted parameters at their defaults: `duration` and `generate_audio` are absent for image quotes and for video models without that parameter. Model-specific parameters are echoed under their contract names.
- `Job.Parameters` (`map[string]any`) carries the same echo from creation, so an application can check a delivered result against the parameters it was charged for.
- A model contract parameter's `Required` now means "no published default, the request must send it"; every parameter with a `Default` is `Required: false` and may be omitted. `ValidateGenerationWithCatalog` already applied defaults before checking `Required`, so local validation is unchanged.
- `GET /v1/models` and `view=contract` responses carry `ETag` (the quoted catalog `version`) and `Cache-Control: private, max-age=300`, and answer `If-None-Match` with 304. `GetModelContracts` does not send conditional requests yet; a custom `HTTPClient` can.

## Upgrading to 0.11.0

0.11.0 is a minor release with incompatible changes. It prepares the 1.0 contract. Upgrading from 0.9, read the [0.10.0 notes](CHANGELOG.md#0100-changes) first; 0.10.0 was never published on its own and ships with this release.

- The bundled model catalog is removed: package-level `ListModelContracts`, `GetModelContract`, `GetModelOperationContract`, `ValidateGeneration` and `ValidateModelParameters` are gone. Fetch the catalog with `client.GetModelContracts` and pass it to `ValidateGenerationWithCatalog` or `ClientOptions.ModelContracts`. New models and parameter changes never need an SDK release.
- Job IDs are opaque. Any non-empty ID of up to 64 characters that is safe as one URL path segment is accepted; store it as a string and do not parse it.
- Without a catalog, a quote may echo the canonical `creator/model` ID for an alias you sent; any other different model fails validation. With a catalog the SDK compares the resolved IDs.
- `APIError.Details` (`[]ErrorDetail`) locates invalid fields of `YIR_INVALID_REQUEST`: `Field`, a stable `Reason` such as `unsupported` or `required`, and `Allowed` contract values.
- Veo 3.0 (`google/veo-3.0-generate-001`) and the Gemini Omni preview (`google/gemini-omni-video`) are retired: they are gone from the API catalog and from the reviewed snapshot that earlier versions bundled. Requests for them return `YIR_INVALID_REQUEST` with `details[0].reason` `retired` and the replacement model in `allowed`.
- Gateway changes released together with this SDK: `parameters` is required; top-level `resolution`, `aspect_ratio`, `n`, `duration` and `generate_audio`, `input.image`, and case-variant `input.type` or reference roles are rejected; `resolution` and `aspect_ratio` must use a model contract value (case-insensitive), so `1024`, `2048x2048` or `16x9` are rejected. Model aliases are reduced to the short name, the vendor model ID and, where one exists, the Vercel AI Gateway ID; prefer canonical IDs such as `bytedance/seedance-2.0`.

Earlier release notes are in the [changelog](CHANGELOG.md).

## Quote and submit

`SubmitImage(ctx, request)` and `SubmitVideo(ctx, request)` generate a random idempotency key per call. You may pass one explicit, non-empty key with no CR/LF as the final argument. The built-in transport retries network failures and HTTP 502/503/504 up to three times (0.5s, 1s, 2s backoff), preserving the exact encoded body and idempotency key. Reads use the same policy. Retries share the request timeout and respect cancellation; Retry-After up to 60s is honored, and longer values are returned without retry. Other writes and terminal failed Jobs are never automatically resubmitted. Recovery across calls or process restarts requires a saved key and exact request. Server fallback within an accepted Job is independent of the client key.

Build a `GenerationRequest` with `Model`, `Input` and explicit `Parameters`; use `QuoteImage` or `QuoteVideo`. Require `Supply.Available` and a priced `Primary`; its amount is an estimate, not a ceiling. Check expiry before approving new work.

After your application's budget approval, persist a `SubmitRequest` containing the exact generation request and `MaxCost`, plus a stable idempotency key. Include routing, references and any `WebhookURL`. Only then call `SubmitImage(ctx, savedRequest, savedKey)` or `SubmitVideo`. A quote does not authorize or trigger generation. Do not generate a new key on retry; an unknown transport outcome must recover with the original request and key. Never silently replace that request with a new quote or budget.

For music and sound effects, use `QuoteAudio` and `SubmitAudio` (the `/v1/audio` endpoints) with the same lifecycle; `QuoteMusic` / `SubmitMusic` are their original names, call the permanent legacy `/v1/music` paths and behave identically. You can also use a `generate_music` / `generate_sound_effect` item in `QuoteBatch`. For text input, set `Input.Prompt` and, where the model takes custom lyrics, `Input.Lyrics`. Suno models also take a cover (`Input.Type` `"reference"`): exactly one `reference_audio` source song in `Input.References` (URL or File ID, up to 8 minutes) and an `Input.Prompt` describing the new style, with the same lyrics rule and the same price as basic generation; `ValidateGenerationWithCatalog` rejects it for other audio models. In both, `Parameters` are optional and each model accepts only what its contract declares (`n`, `duration`, `instrumental`, `lyrics_optimizer`). Vocal music needs a lyrics source the model supports: `Lyrics`, `lyrics_optimizer: true` (writes lyrics from the prompt; some models add a charge shown in the quote) or `instrumental: true`; these exclude each other. ElevenLabs music takes no lyrics and is priced by `duration` (30–300 s in fixed steps, default 60); ElevenLabs sound effects (`elevenlabs/sound-effects-v2`) take a description, no lyrics and `duration` 1–22 s (default 5), and their quote reports operation `generate_sound_effect`. Suno (`suno/suno-v6`, unofficial access; Suno has no official API) returns two tracks per request (`n` is always 2). The SDK checks shared conflicts before sending; `ValidateGenerationWithCatalog` also checks `n`, `duration` and the lyrics source against the model contract, and the Gateway enforces per-model text limits. Each audio file reports its measured length as `ResultFile.DurationMS`. A music quote echo has no `resolution` or `aspect_ratio`.

Text-to-speech models (`minimax/speech-2.8-hd`, up to 10000 characters; `elevenlabs/eleven-v3`, up to 5000 characters) also use `QuoteAudio` / `SubmitAudio`, or a `generate_speech` item in `QuoteBatch`: `Input.Prompt` is the exact text to read aloud, and `Parameters` take only `n` (1) and `voice`, a preset voice ID of the model (omit it for the model default; the voice does not change the price). There are no lyrics, `instrumental`, `lyrics_optimizer` or `duration`. The quote reports operation `generate_speech`, is priced per character of the prompt (spaces, punctuation and audio tags included) and echoes `n` and `voice`; the Job delivers one MP3 with its measured `ResultFile.DurationMS`.

```go
request := yir.GenerationRequest{Model: "minimax/music-2.6", Input: yir.GenerationInput{
	Type: "text", Prompt: "A warm acoustic folk ballad", Lyrics: "[Verse]\nWalking down a dusty road"}}
quote, err := client.QuoteAudio(ctx, request)
job, err := client.SubmitAudio(ctx, yir.SubmitRequest{GenerationRequest: request, MaxCost: &maxCost}, savedKey)
```

For 3D, use `Quote3D` and `Submit3D` (the `/v1/3d` endpoints) with the same lifecycle, or a `generate_3d` item in `QuoteBatch`. `Input.Type` is `text` (with `Prompt`), `image` (exactly one `reference_image`, empty `Prompt`) or `multiview` (one `front_view` plus at least one of `left_view`, `back_view` and `right_view`, each at most once, empty `Prompt`; only models whose contract lists the multiview input mode). `Parameters` are optional: `texture` (`none`, `standard`, `hd`), `pbr` (needs a texture; `texture: "none"` with `pbr: true` is rejected), `face_limit`, `topology` (`triangle`, `quad`) and `n` (always 1); each model accepts only the values its contract declares, and omitted ones take the model default. `ValidateGenerationWithCatalog("generate_3d", request, catalog)` checks the input mode, references and values against the model contract. The Job delivers one glb file (`model/gltf-binary`) with its measured triangle count in `ResultFile.Faces`; an over-delivered result (textures or PBR maps you did not ask for) is still delivered with a parameter notice. Demo mode has no 3D sample: `Submit3D` returns `ErrDemoOperationUnsupported` without sending.

```go
model := yir.GenerationRequest{Model: "tripo/tripo-p2", Input: yir.GenerationInput{
	Type: "image", References: []yir.Reference{{Role: "reference_image", URL: "https://example.com/chair.png"}}},
	Parameters: map[string]any{"texture": "standard", "pbr": false}}
quote, err := client.Quote3D(ctx, model)
job, err := client.Submit3D(ctx, yir.SubmitRequest{GenerationRequest: model, MaxCost: &maxCost}, savedKey)
```

See [the compile-checked example](client_example_test.go) and its [integration guide](examples/README.md). The example leaves customer authorization and durable storage to the application.

**Warning: a tight `MaxCost` can interrupt delivery during failover.** Even after a Job is accepted, a failed channel may need to be replaced by a more expensive one. If its estimate exceeds the remaining budget after earlier billed attempts, Yir skips it; if no eligible fallback fits, the Job fails with `YIR_BUDGET_EXCEEDED` and may deliver no result. When delivery continuity is more important than a per-Job spending cap, omit this optional field; otherwise leave room for more expensive fallback channels and earlier attempts' charges. Omitting it removes the per-Job cap, so actual charges can exceed the quote; account balance and other limits still apply.

Billing: the balance is not frozen. Every attempt the upstream actually bills is charged at its authoritative upstream amount after the managed discount, including failed attempts and attempts followed by a fallback; attempts the upstream never billed, and Yir's own delivery failures and outcome timeouts, cost nothing. `MaxCost` caps the Job's total charge and skips routes whose estimate exceeds it. The quote's primary price is an estimate, not a ceiling. Prices can change after you quote: a cheaper channel can go offline or cool down, a routing default can change which channels are eligible, or a catalog price can change. Use `MaxCost` as a guard against runaway charges with headroom over the quote, not as a price lock; a cap set to the quote can start failing with `YIR_BUDGET_EXCEEDED` (422 at submit, naming the lowest current estimate, or on the Job). On that error, quote again and let your application decide whether to raise the cap on a new request; do not raise it automatically.

New requests use actual channel bills by default; no billing mode selection is needed. A channel without a reliable estimate may still be available, but cannot accept `max_cost`; choose a channel with an estimate when you need a cap. An unknown price never means free.

## Jobs, files and Webhooks

Persist the returned job ID. `GetJob` queries full job details; `GetJobStatus` queries lightweight `JobStatusResponse` summaries. `WaitJob` long-polls status summaries by default: `GetJobStatusWithWait` lets the Gateway hold a query until the status changes (at most 30 seconds), and `WaitOptions.StatusWait` defaults to `DefaultStatusWait` (20s, kept inside the HTTP client timeout and the context deadline; negative disables), so a terminal Job is seen about a second after Yir records it, without a Webhook. When a Gateway answers without holding, it falls back to the `PollDelay` backoff (5s for the first 30 seconds, 10s until about 90 seconds, then 20s); set `WaitOptions.PollInterval` for a fixed interval. A `429 YIR_RATE_LIMITED` status query (per-API-key requests per minute) is waited out per `Retry-After` (`APIError.RetryAfter`, default 1s, capped at 1 minute), up to 5 times in a row. It reads the full `Job` detail only once at terminal states and rejecting terminal status mismatches with `ErrJobStateInconsistent`. Cancel or time out its context to stop local waiting, which returns a zero-value `Job{}` and does not cancel the remote job or imply a refund. Resume with the saved ID. `JobError` contains the failed/cancelled terminal job; `APIError` contains HTTP status, code, message, retryable and action. Use stable codes for application logic.

`CancelJob` explicitly requests cancellation. Inspect cancellation status and terminal billing instead of assuming immediate success or zero charge. Apply `Billing.TotalChargedByYir` once per job after `Billing.Status` becomes `settled`, including error paths. A terminal result can still have `pending` billing; poll `GetJob` or process the independent `job.billing_settled` webhook. Deduplicate fulfillment and billing settlement separately by Job ID; `ComputeCharges`, `GatewayFee` and `OfficialComparison` explain that total. Compare `APIError.Code` with the `ErrCode*` constants rather than string literals. `APIError.RequestID` carries the `request_id` of a failed HTTP request; include it when contacting Yir support.

`Job`, `JobStatusResponse`, `Quote`, `File` and `ModelDetail` keep the exact JSON they were decoded from: `RawJSON()` returns it, so fields newer than the SDK (including nested ones such as new billing details) can be read with `json.Unmarshal` before a release models them. Values built in code, and values passed through `json.Marshal`, return `nil` or the re-encoded form.

A media reference sets exactly one of `FileID` (a ready File) or `URL` (a public HTTPS URL that Yir imports at submission, up to 100 MiB; data URLs are refused). Use Files for larger media or media that is not publicly reachable. `CompleteFile` may return `processing`; `UploadFile` waits for `ready` with a five-minute default timeout. Resume waiting with `WaitForFileReady` and the saved file ID; a local timeout does not cancel server analysis.

`CreateFiles(ctx, request, key)` creates upload plans. `UploadFile(ctx, plan, source)` uploads from an `io.ReaderAt` and completes the file; `CreateAndUploadFile(ctx, metadata, source, key)` combines the steps. Keep a stable upload key and file IDs. `GetFile` checks state; `CompleteFile` completes a manually uploaded file. Use ready files as generation references with `FileID` and the appropriate role. Single and multipart upload plans are supported.

`GetFileContentURL(ctx, id)` returns the short-lived signed URL of a ready file. The SDK reads it from the 307 `Location` header and never follows the redirect, so the API key is never sent to storage. Fetch the URL without Gateway credentials and ask again once it expires. Only an absolute `https` URL is accepted. Anything else fails with `file_content_response_invalid`, and errors never include the URL. Missing files return `*APIError` 404 `YIR_FILE_NOT_FOUND`. Files not yet ready return 409 `YIR_FILE_NOT_READY` (wait with `WaitForFileReady`, then retry). Expired files return 410 `YIR_FILE_EXPIRED` (upload them again).

Set `SubmitRequest.WebhookURL` for callbacks. `VerifyWebhookSignature` takes `Secret`, `ID`, `Timestamp`, `Signature` and `RawBody`. Use the account Webhook secret, not the API key, and exact bytes captured before JSON parsing. Map the delivery's signature metadata into those fields. Default clock tolerance is 300 seconds. Check both the returned error and `Valid`; durably deduplicate by Webhook ID and settle once even when polling also observes the terminal job. `ConstructWebhookEvent` verifies the same fields and returns the Webhook ID and terminal `Job`, or a `*WebhookVerificationError` with a stable `Reason`. Reason `unsupported_event` means the signature is valid but the body is not a terminal Job this SDK understands, such as an event type newer than the SDK; acknowledge it with a 2xx response, log it and deduplicate by its `ID`. Answer other reasons with a 4xx response. Durable workflows that cannot block in `WaitJob` can treat a webhook as a wake-up signal, read the job with `GetJob`, and keep `PollDelay` polling as a fallback.

## Demo mode

Demo mode tests the whole generation flow without spending: set `ClientOptions.Demo` to `&yir.DemoOptions{}` (the Go SDK reads no environment variables; map your own flag to it). Submits run the usual local checks and then the matching quote (free), so the Gateway still validates the parameters, but the request is never submitted. The submit returns a demo Job whose ID starts with `demo_` and carries the quote's model and echoed parameters. Quotes, files, balance and model calls use the Gateway as usual, so an API Key is still required.

A demo Job keeps no state: its ID encodes the creation time, type, aspect ratio, `n`, duration, resolution and scenario, so `GetJob`, `GetJobStatusWithWait` (holding until the next change) and `WaitJob` give the same answer in any process, without a network call, and match the TypeScript SDK. Every `Client` answers `demo_` IDs locally, also with demo mode off; `IsDemoJobID(id)` tells them apart. An image is queued for 2 seconds and succeeds after 8, a video after 25 seconds, audio after 12. The result points at fixed files under `DemoAssetBaseURL` (`https://public.yir.ai/demo/v1/`) with a DEMO badge, picked by type and the nearest aspect ratio (and 5 or 10 second video length); `Width`, `Height` and `DurationMS` describe the actual file, and the requested values stay in `Parameters`. Billing is always `"0"`.

`DemoOptions.Scenario` or a `[demo:<scenario>]` marker in the prompt (which wins) picks the outcome: `DemoScenarioOK` (default); `DemoScenarioSlow`, queued for 6 minutes and succeeded after 8; `DemoScenarioFail`, failed with `YIR_EXECUTION_FAILED` and nothing charged; `DemoScenarioReject`, the submit returns `*APIError` 422 `YIR_INPUT_REJECTED` (inside a `*SubmissionError`) after the quote; `DemoScenarioCancel`, ends `cancelled`. `CancelJob` on an unfinished demo Job returns it `cancelled` and on an ended one returns 409 `YIR_JOB_NOT_CANCELLABLE`; because nothing is stored, later reads follow the original timeline, so keep the Job `CancelJob` returns.

The submit returns the quote's full `Parameters` echo; later reads of a demo Job keep only `n`, `aspect_ratio`, `resolution` and `duration`, which fit in the ID. Demo mode does not cover idempotent replay of a submit, balance, spend-limit or `MaxCost` admission errors, Webhook delivery, partial or expired results, or fallback billing.

## Pricing and contracts

`GetModel(ctx, "creator/model")` reads the Market `ModelDetail`: `Specifications` with per-channel `Channels` display prices (`AmountMicros` is `nil` when no price is published) and optional `ChannelParameters`. Pass the canonical ID; aliases are not resource paths, and an invalid ID fails locally with `model_request_invalid`. The SDK ignores unknown fields and accepts operations, input modes, currencies, availability values and rule behaviors newer than the SDK, but rejects a mismatched ID or missing/empty required values with `model_response_invalid`. A missing model returns `*APIError` 404 `YIR_MODEL_NOT_FOUND`. Market prices are for display only; use a quote before submitting. `GetModelContract` remains the versioned parameter contract (`view=contract`).

Submission and quote clients perform protocol checks and let the Gateway validate model parameters, even with `ClientOptions.ModelContracts`. A stale catalog must not reject newly supported parameter values. `ValidateGenerationWithCatalog` remains explicitly strict; use it when you deliberately want to restrict requests to a catalog snapshot.

Failed submit calls return `*SubmissionError` with `IdempotencyKey`; use `errors.As` to retrieve it and recover with the exact original request. `Unwrap` preserves the transport/API error. Persist a caller-generated key before submission for crash recovery. `client.GetBalance(ctx)` reads a wallet snapshot in USD decimal strings; available and total amounts can be negative after settlement. Reading balance is optional and does not authorize or gate submission.

## Verify

From this directory, run `go test -p 2 ./...` with `GOWORK=off` and `GOMAXPROCS=2` for isolated module verification. Examples without an `Output` directive are compiled but not executed. Optional external price-fixture tests skip when their input is absent. No Node installation is needed.

New requests should omit `billing_mode`. Retrying a persisted request must keep the original body and idempotency key, including legacy `billing_mode`. Treat absent or unknown billing status as unconfirmed; do not infer settlement from a zero charge.
