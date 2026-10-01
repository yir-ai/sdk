# Yir Go SDK

> 0.2.0 protocol / 协议升级：模型参数来自 API，SDK 不再以内置模型清单限制请求；旧全量价格表与客户端计价已移除。升级前阅读 [migration guide](https://github.com/yir-ai/sdk/blob/main/typescript/docs/parameter-contracts.md)。

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

Server-side image and video API client. Requires Go 1.25+. Module: `github.com/yir-ai/sdk/go`. [MIT](LICENSE).

## Install

Run in your application's Go module:

```sh
go get github.com/yir-ai/sdk/go@v0.7.0
```

Module release tags use `go/vX.Y.Z`; this version uses `go/v0.7.0`. The module includes its required test vectors and works without Node or the repository's `spec/` directory.

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

Keep the key on your server. The default base URL is `https://gateway.yir.ai`; configure `ClientOptions.BaseURL` and `ClientOptions.HTTPClient` if needed. The default HTTP timeout is 30 seconds, and redirects are rejected.

## 0.7.0 changes

0.7.0 is a minor release with incompatible changes:

- Explicit `BillingMode: "actual"` is supported; see the [repository overview](https://github.com/yir-ai/sdk/blob/main/README.md) for its consent and debt terms.
- `ComputeCharge` describes only managed supply billed by Yir: `Amount` changes from `*string` to `string`, and retired BYOK values no longer appear. Code reading `Amount` must drop the dereference.

Model, parameter and pricing changes that the existing protocol can express no longer need an SDK release:

- `GetModelContracts` and `GetModelContract` ignore fields newer than the SDK and accept new operations, input modes, parameter types and controls. Rule keys the SDK does not understand are left to the Gateway, while known rules keep their meaning and still apply; values of a newer parameter type are not checked locally.
- `ValidateGenerationProtocol`, used when no catalog is configured, checks only the protocol skeleton. Prompt length, reference sources and `file_id` format, routing provider codes, preferences and limits are Gateway checks. `GenerationRequest.Extra` sends top-level fields newer than the SDK and is restored when a persisted request is unmarshaled. Fields the SDK models (`model`, `input`, `parameters`, `routing`, `billing_mode`, `max_cost`, `webhook_url`) are rejected in `Extra` with `reserved_field` and never sent from it.
- `Quote.Validate` keeps amounts, currency and price ordering strict, but accepts newer price kinds (amount is a decimal or nil), supply issues, reasons and estimate scopes/usage metrics. `QuoteBatch` items accept any error code.
- `ValidateGeneration` and `ValidateModelParameters` are deprecated: they use the historical bundled catalog. Use `ValidateGenerationWithCatalog` with current `GetModelContracts` data.

## 0.4.0 changes

`WaitJob` without `WaitOptions.PollInterval` now backs off with `PollDelay` (5s, then 10s, then 20s) instead of polling every 2 seconds. Set `PollInterval` to keep a fixed interval. `ConstructWebhookEvent` is new. No call signatures change. In 0.4.1, `ConstructWebhookEvent` also rejects Job IDs that `GetJob` would reject, and `PollDelay` documents `poll` as the zero-based index of the query that just completed. In 0.4.2, `Quote.Validate` also rejects quotes whose `supply` disagrees with their prices, matching the TypeScript validator.

## 0.3.0 migration

In **Go 0.3.0**, the final generation key argument changes from `string` to `...string`; this is an incompatible public API change under the module's 0.x release rules. Ordinary calls such as `client.SubmitImage(ctx, request, savedKey)` still compile, and calls without a key now work. The same change applies to `SubmitVideo`.

Custom interfaces must declare `SubmitImage(context.Context, yir.SubmitRequest, ...string) (yir.Job, error)` (and the analogous video method). A method value no longer matches `func(context.Context, yir.SubmitRequest, string) (yir.Job, error)`. Preserve that function type with a wrapper:

```go
submit := func(ctx context.Context, request yir.SubmitRequest, key string) (yir.Job, error) {
    return client.SubmitImage(ctx, request, key)
}
```

See the compile-checked [migration example](client_example_test.go).

## Quote and submit

Starting in 0.3.0, `SubmitImage(ctx, request)` and `SubmitVideo(ctx, request)` generate a random idempotency key per call. You may pass one explicit, non-empty key with no CR/LF as the final argument. Submit has no hidden retries. Recovery across calls or process restarts requires a saved key and exact request. Server fallback within an accepted Job is independent of the client key.

Build a `GenerationRequest` with `Model`, `Input` and explicit `Parameters`; use `QuoteImage` or `QuoteVideo`. For a conservative fixed-price flow, require `Supply.Available`, `Primary.Kind == "fixed"`, `HasVerifiableUpperBound` and a non-nil `SingleAttemptUpperBound`. Check expiry before approving new work. These are application acceptance rules; other API quote kinds remain supported.

After your application's budget approval, persist a `SubmitRequest` containing the exact generation request and `MaxCost`, plus a stable idempotency key. Include routing, references and any `WebhookURL`. Only then call `SubmitImage(ctx, savedRequest, savedKey)` or `SubmitVideo`. A quote does not authorize or trigger generation. Do not generate a new key on retry; an unknown transport outcome must recover with the original request and key. Never silently replace that request with a new quote or budget.

See [the compile-checked example](client_example_test.go) and its [integration guide](examples/README.md). The example leaves customer authorization and durable storage to the application.

## Jobs, files and Webhooks

Persist the returned job ID. `GetJob` queries full job details; `GetJobStatus` queries lightweight `JobStatusResponse` summaries. `WaitJob` polls status summaries with the `PollDelay` backoff by default (5s for the first 30 seconds, 10s until about 90 seconds, then 20s); set `WaitOptions.PollInterval` for a fixed interval. It reads the full `Job` detail only once at terminal states and rejecting terminal status mismatches with `ErrJobStateInconsistent`. Cancel or time out its context to stop local waiting, which returns a zero-value `Job{}` and does not cancel the remote job or imply a refund. Resume with the saved ID. `JobError` contains the failed/cancelled terminal job; `APIError` contains HTTP status, code, message, retryable and action. Use stable codes for application logic.

`CancelJob` explicitly requests cancellation. Inspect cancellation status and terminal billing instead of assuming immediate success or zero charge. Apply `Billing.TotalChargedByYir` once per job, including error paths; `ComputeCharges`, `GatewayFee`, `Savings` and `OfficialComparison` explain that total. Compare `APIError.Code` with the `ErrCode*` constants rather than string literals.

Version 0.6.1 is compatible with 0.6.0. `GetModel` now fails with `model_response_invalid` when a channel price omits `estimated` or a channel parameter entry omits `parameter_rules`, instead of reading them as `false` or empty. The bundled `minimax/minimax-h3` descriptions match the current server export.

Version 0.5.1 is compatible with 0.5.0. `Job` adds `FinalProvider`, `URLs` and `Usage`; `JobBilling` adds `ComputeCharges`, `GatewayFee`, `Savings` and `OfficialComparison`. `ErrCode*` constants and `Version` are new, and the User-Agent now reports the SDK version. The bundled model contracts match the current server export: `alibaba/qwen-image-2.1` is added, Gemini Omni accepts `duration`, `wan-2.6` allows at most 5 references, and the `kie/gemini-omni-video` alias is removed. Only explicit bundled-contract validators are affected; runtime requests without a caller catalog are unchanged. Check `Result.Availability` and copy available result files before their URLs expire.

Version 0.5.0 requires `FileID` for media references and rejects external reference URLs. Upload original bytes first. `CompleteFile` may return `processing`; `UploadFile` waits for `ready` with a five-minute default timeout. Resume waiting with `WaitForFileReady` and the saved file ID; a local timeout does not cancel server analysis.

`CreateFiles(ctx, request, key)` creates upload plans. `UploadFile(ctx, plan, source)` uploads from an `io.ReaderAt` and completes the file; `CreateAndUploadFile(ctx, metadata, source, key)` combines the steps. Keep a stable upload key and file IDs. `GetFile` checks state; `CompleteFile` completes a manually uploaded file. Use ready files as generation references with `FileID` and the appropriate role. Single and multipart upload plans are supported.

Since 0.6.0: `GetFileContentURL(ctx, id)` returns the short-lived signed URL of a ready file. The SDK reads it from the 307 `Location` header and never follows the redirect, so the API key is never sent to storage. Fetch the URL without Gateway credentials and ask again once it expires. Only an absolute `https` URL is accepted. Anything else fails with `file_content_response_invalid`, and errors never include the URL. Missing files return `*APIError` 404 `YIR_FILE_NOT_FOUND`. Files not yet ready return 409 `YIR_FILE_NOT_READY` (wait with `WaitForFileReady`, then retry). Expired files return 410 `YIR_FILE_EXPIRED` (upload them again).

Set `SubmitRequest.WebhookURL` for callbacks. `VerifyWebhookSignature` takes `Secret`, `ID`, `Timestamp`, `Signature` and `RawBody`. Use the account Webhook secret, not the API key, and exact bytes captured before JSON parsing. Map the delivery's signature metadata into those fields. Default clock tolerance is 300 seconds. Check both the returned error and `Valid`; durably deduplicate by Webhook ID and settle once even when polling also observes the terminal job. `ConstructWebhookEvent` verifies the same fields and returns the Webhook ID and terminal `Job`, or a `*WebhookVerificationError` with a stable `Reason`. Durable workflows that cannot block in `WaitJob` can treat a webhook as a wake-up signal, read the job with `GetJob`, and keep `PollDelay` polling as a fallback.

## Pricing and contracts

Since 0.6.0: `GetModel(ctx, "creator/model")` reads the Market `ModelDetail`: `Specifications` with per-channel `Channels` display prices (`AmountMicros` is `nil` when no price is published) and optional `ChannelParameters`. Pass the canonical ID; aliases are not resource paths, and an invalid ID fails locally with `model_request_invalid`. The SDK ignores unknown fields but rejects a mismatched ID or invalid required values with `model_response_invalid`. A missing model returns `*APIError` 404 `YIR_MODEL_NOT_FOUND`. Market prices are for display only; use a quote before submitting. `GetModelContract` remains the versioned parameter contract (`view=contract`).

## Contract updates in 0.2.0

H3 reference input accepts 1–15 references: up to 9 images, 3 videos and 3 audio files, including audio-only input, preserving URLs and order. Image-to-video remains adaptive-only. The KIE integration verified on 2026-09-16 supports mixed references within those limits, but requires at least one image or video; audio-only input passes the public contract but is not accepted by this supply. Each video/audio clip must be 2–15 seconds, with video and audio each totaling at most 15 seconds. Video/audio references require measured, ready Files owned by the caller, supplied as `file_id`; image URLs remain supported. Quote and admission use trusted measurements, and submission checks the bound measurement snapshot. Other channels retain their own supported subsets. A valid quote covering the complete request is required; static SDK validation does not establish live availability or successful generation. The earlier 1–5-image limit describes a historical supply snapshot, not the current KIE integration.

Job results may include `result.warnings: ["additional_results_unavailable"]` when the primary result was delivered but an optional additional result was not. The job remains `succeeded` and `files` contains only delivered files. Normal and historical responses may omit warnings; expired results may retain historical warnings. This is not generation failure, does not authorize automatic regeneration, and does not change charges or `parameter_notices`.

Seedance 2.0 accepts optional boolean `return_last_frame` (default false); other models reject it. Requesting a last frame requires a valid quote covering its full cost, not ordinary video pricing. Actual last-frame delivery remains unverified.

Seedream 5.0 text and image contracts now accept `4K`; image input allows up to 14 references. Other parameters are unchanged. This contract update does not establish live 4K availability, pricing or exact output dimensions; those remain subject to server integration and quotes.

This working revision accepts optional boolean `web_search` and `image_search` in Nano Banana 2 `Parameters` for text and image input. Both default to false; image search requires web search. Nano Banana Pro accepts only optional boolean `web_search` (default false) for text and image input; it rejects `image_search`, including explicit false. All other models reject both fields. Provider search execution remains to be verified; this metadata update does not change prices or enable supply. The validator preserves the request and enforces per-role reference counts, required alternatives, output-duration limits and duplicate-reference rejection. Search availability and charges require a supported supply and a valid quote. These updates are not in the published `v0.1.0` module.

This working revision introduces `GetJobStatus` (`GET /v1/jobs/{id}/status`) and migrates `WaitJob` to poll lightweight `JobStatusResponse` summaries, reading the full `Job` detail only once upon reaching terminal status (`succeeded`, `failed`, or `cancelled`). Terminal status mismatches return `ErrJobStateInconsistent`. `WaitOptions.OnPoll` now receives `JobStatusResponse` instead of `Job`. Wait interruptions (context cancellation, timeouts) and transport, validation, or consistency errors return a zero-value `Job{}` without synthesizing partial jobs, with `JobError` as the sole exception returning the complete failed or cancelled terminal `Job`. Status 404 does not silently fall back to the detail endpoint. Delivered results preserve optional `result.warnings`. These incompatible polling and error return changes are included in 0.2.0; follow the migration guide when upgrading from 0.1.0.

## Verify

From this directory, run `go test -p 2 ./...` with `GOWORK=off` and `GOMAXPROCS=2` for isolated module verification. Examples without an `Output` directive are compiled but not executed. Optional external price-fixture tests skip when their input is absent. No Node installation is needed.
