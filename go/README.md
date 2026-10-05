# Yir Go SDK

> Beta (0.x). Incompatible changes ship only in minor releases, with migration notes in the README and [changelog](https://github.com/yir-ai/sdk/blob/main/go/CHANGELOG.md). Fields and values newer than the SDK are read as data, so new models and options do not need an SDK release.

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

Server-side image and video API client. Requires Go 1.25+. Module: `github.com/yir-ai/sdk/go`. [MIT](LICENSE).

## Install

Run in your application's Go module:

```sh
go get github.com/yir-ai/sdk/go@v0.10.0
```

Module release tags use `go/vX.Y.Z`; this version uses `go/v0.10.0`. The module includes its required test vectors and works without Node or the repository's `spec/` directory.

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

## Upgrading to 0.10.0

0.10.0 is a minor release with incompatible changes. It removes surface that the Gateway no longer uses:

- `Quote` drops `Max`, `SingleAttemptUpperBound` and `HasVerifiableUpperBound`, and `QuoteSupply` drops `RequiresMaxCost`. The Gateway still returns them as constants for older SDKs, and this SDK ignores them. Read `Primary` for the estimate and set your own `MaxCost`.
- `JobBilling.Savings` and the `Savings` type are removed; the Gateway stopped returning them on 2026-10-02. Use `OfficialComparison`.
- `ModelParameterContract.Policy`, the `ParameterPolicy` type and the logged warnings on quote/submit are removed. Model contracts no longer carry policies; quotes and Jobs report actual handling in `ParameterNotices`.
- `RoutingPreferenceBalanced` is removed. The Gateway still accepts `balanced` as an alias of `cost`; use `RoutingPreferenceCost`.

Earlier release notes are in the [changelog](CHANGELOG.md).

## Quote and submit

`SubmitImage(ctx, request)` and `SubmitVideo(ctx, request)` generate a random idempotency key per call. You may pass one explicit, non-empty key with no CR/LF as the final argument. Submit has no hidden retries. Recovery across calls or process restarts requires a saved key and exact request. Server fallback within an accepted Job is independent of the client key.

Build a `GenerationRequest` with `Model`, `Input` and explicit `Parameters`; use `QuoteImage` or `QuoteVideo`. Require `Supply.Available` and a priced `Primary`; its amount is an estimate, not a ceiling. Check expiry before approving new work.

After your application's budget approval, persist a `SubmitRequest` containing the exact generation request and `MaxCost`, plus a stable idempotency key. Include routing, references and any `WebhookURL`. Only then call `SubmitImage(ctx, savedRequest, savedKey)` or `SubmitVideo`. A quote does not authorize or trigger generation. Do not generate a new key on retry; an unknown transport outcome must recover with the original request and key. Never silently replace that request with a new quote or budget.

See [the compile-checked example](client_example_test.go) and its [integration guide](examples/README.md). The example leaves customer authorization and durable storage to the application.

Billing: the balance is not frozen. Every attempt the upstream actually bills is charged at its authoritative upstream amount after the managed discount, including failed attempts and attempts followed by a fallback; attempts the upstream never billed, and Yir's own delivery failures and outcome timeouts, cost nothing. `MaxCost` caps the Job's total charge and skips routes whose estimate exceeds it. The quote's primary price is an estimate, not a ceiling. Explicit `BillingMode: "actual"` (KIE/APIMart Kling 2.6/3.0 Motion Control and FAL FLUX 2 Pro image editing only) requires `Routing.Only`, cannot be combined with `MaxCost` and has no ceiling; amounts the balance cannot cover become debt, repaid by a later manual top-up, that blocks new Jobs. Persist that customer consent with the exact request and idempotency key.

## Jobs, files and Webhooks

Persist the returned job ID. `GetJob` queries full job details; `GetJobStatus` queries lightweight `JobStatusResponse` summaries. `WaitJob` long-polls status summaries by default: `GetJobStatusWithWait` lets the Gateway hold a query until the status changes (at most 30 seconds), and `WaitOptions.StatusWait` defaults to `DefaultStatusWait` (20s, kept inside the HTTP client timeout and the context deadline; negative disables), so a terminal Job is seen about a second after Yir records it, without a Webhook. When a Gateway answers without holding, it falls back to the `PollDelay` backoff (5s for the first 30 seconds, 10s until about 90 seconds, then 20s); set `WaitOptions.PollInterval` for a fixed interval. It reads the full `Job` detail only once at terminal states and rejecting terminal status mismatches with `ErrJobStateInconsistent`. Cancel or time out its context to stop local waiting, which returns a zero-value `Job{}` and does not cancel the remote job or imply a refund. Resume with the saved ID. `JobError` contains the failed/cancelled terminal job; `APIError` contains HTTP status, code, message, retryable and action. Use stable codes for application logic.

`CancelJob` explicitly requests cancellation. Inspect cancellation status and terminal billing instead of assuming immediate success or zero charge. Apply `Billing.TotalChargedByYir` once per job, including error paths; `ComputeCharges`, `GatewayFee` and `OfficialComparison` explain that total. Compare `APIError.Code` with the `ErrCode*` constants rather than string literals. `APIError.RequestID` carries the `request_id` of a failed HTTP request; include it when contacting Yir support.

`Job`, `JobStatusResponse`, `Quote`, `File` and `ModelDetail` keep the exact JSON they were decoded from: `RawJSON()` returns it, so fields newer than the SDK (including nested ones such as new billing details) can be read with `json.Unmarshal` before a release models them. Values built in code, and values passed through `json.Marshal`, return `nil` or the re-encoded form.

A media reference sets exactly one of `FileID` (a ready File) or `URL` (a public HTTPS URL that Yir imports at submission, up to 100 MiB; data URLs are refused). Use Files for larger media or media that is not publicly reachable. `CompleteFile` may return `processing`; `UploadFile` waits for `ready` with a five-minute default timeout. Resume waiting with `WaitForFileReady` and the saved file ID; a local timeout does not cancel server analysis.

`CreateFiles(ctx, request, key)` creates upload plans. `UploadFile(ctx, plan, source)` uploads from an `io.ReaderAt` and completes the file; `CreateAndUploadFile(ctx, metadata, source, key)` combines the steps. Keep a stable upload key and file IDs. `GetFile` checks state; `CompleteFile` completes a manually uploaded file. Use ready files as generation references with `FileID` and the appropriate role. Single and multipart upload plans are supported.

`GetFileContentURL(ctx, id)` returns the short-lived signed URL of a ready file. The SDK reads it from the 307 `Location` header and never follows the redirect, so the API key is never sent to storage. Fetch the URL without Gateway credentials and ask again once it expires. Only an absolute `https` URL is accepted. Anything else fails with `file_content_response_invalid`, and errors never include the URL. Missing files return `*APIError` 404 `YIR_FILE_NOT_FOUND`. Files not yet ready return 409 `YIR_FILE_NOT_READY` (wait with `WaitForFileReady`, then retry). Expired files return 410 `YIR_FILE_EXPIRED` (upload them again).

Set `SubmitRequest.WebhookURL` for callbacks. `VerifyWebhookSignature` takes `Secret`, `ID`, `Timestamp`, `Signature` and `RawBody`. Use the account Webhook secret, not the API key, and exact bytes captured before JSON parsing. Map the delivery's signature metadata into those fields. Default clock tolerance is 300 seconds. Check both the returned error and `Valid`; durably deduplicate by Webhook ID and settle once even when polling also observes the terminal job. `ConstructWebhookEvent` verifies the same fields and returns the Webhook ID and terminal `Job`, or a `*WebhookVerificationError` with a stable `Reason`. Reason `unsupported_event` means the signature is valid but the body is not a terminal Job this SDK understands, such as an event type newer than the SDK; acknowledge it with a 2xx response, log it and deduplicate by its `ID`. Answer other reasons with a 4xx response. Durable workflows that cannot block in `WaitJob` can treat a webhook as a wake-up signal, read the job with `GetJob`, and keep `PollDelay` polling as a fallback.

## Pricing and contracts

`GetModel(ctx, "creator/model")` reads the Market `ModelDetail`: `Specifications` with per-channel `Channels` display prices (`AmountMicros` is `nil` when no price is published) and optional `ChannelParameters`. Pass the canonical ID; aliases are not resource paths, and an invalid ID fails locally with `model_request_invalid`. The SDK ignores unknown fields and accepts operations, input modes, currencies, availability values and rule behaviors newer than the SDK, but rejects a mismatched ID or missing/empty required values with `model_response_invalid`. A missing model returns `*APIError` 404 `YIR_MODEL_NOT_FOUND`. Market prices are for display only; use a quote before submitting. `GetModelContract` remains the versioned parameter contract (`view=contract`).

A client created with `ClientOptions.ModelContracts` validates parameters and references only for the models, operations and input modes that catalog describes. Anything else, such as a model published after the catalog was read, gets protocol checks only and is left to the Gateway, so refresh the catalog with `GetModelContracts` when you need local checks for new models. `ValidateGenerationWithCatalog` stays strict and rejects a model outside the catalog with `model_contract_unavailable`; call it yourself to limit requests to that catalog.

## Verify

From this directory, run `go test -p 2 ./...` with `GOWORK=off` and `GOMAXPROCS=2` for isolated module verification. Examples without an `Output` directive are compiled but not executed. Optional external price-fixture tests skip when their input is absent. No Node installation is needed.
