# Yir Go SDK

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

Server-side image and video API client. Requires Go 1.25+. Module: `github.com/yir-ai/sdk/go`. [MIT](LICENSE).

## Install

Run in your application's Go module:

```sh
go get github.com/yir-ai/sdk/go@v0.1.0
```

Module release tags use `go/vX.Y.Z`; this version is tagged `go/v0.1.0`. The module includes its required test vectors and works without Node or the repository's `spec/` directory.

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

## Quote and submit

Build a `GenerationRequest` with `Model`, `Input` and explicit `Parameters`; use `QuoteImage` or `QuoteVideo`. For a conservative fixed-price flow, require `Supply.Available`, `Primary.Kind == "fixed"`, `HasVerifiableUpperBound` and a non-nil `SingleAttemptUpperBound`. Check expiry before approving new work. These are application acceptance rules; other API quote kinds remain supported.

After your application's budget approval, persist a `SubmitRequest` containing the exact generation request and `MaxCost`, plus a stable idempotency key. Include routing, references and any `WebhookURL`. Only then call `SubmitImage(ctx, savedRequest, savedKey)` or `SubmitVideo`. A quote does not authorize or trigger generation. Do not generate a new key on retry; an unknown transport outcome must recover with the original request and key. Never silently replace that request with a new quote or budget.

See [the compile-checked example](client_example_test.go) and its [integration guide](examples/README.md). The example leaves customer authorization and durable storage to the application.

## Jobs, files and Webhooks

Persist the returned job ID. `GetJob` queries it; `WaitJob` polls every 2 seconds by default using `WaitOptions`. Cancel or time out its context to stop local waiting; this does not cancel the remote job or imply a refund. Resume with the saved ID. `JobError` contains the failed/cancelled terminal job; `APIError` contains HTTP status, code, message, retryable and action. Use stable codes for application logic.

`CancelJob` explicitly requests cancellation. Inspect cancellation status and terminal billing instead of assuming immediate success or zero charge. Apply `Billing.TotalChargedByYir` once per job, including error paths. Check `Result.Availability` and copy available result files before their URLs expire.

`CreateFiles(ctx, request, key)` creates upload plans. `UploadFile(ctx, plan, source)` uploads from an `io.ReaderAt` and completes the file; `CreateAndUploadFile(ctx, metadata, source, key)` combines the steps. Keep a stable upload key and file IDs. `GetFile` checks state; `CompleteFile` completes a manually uploaded file. Use ready files as generation references with `FileID` and the appropriate role. Single and multipart upload plans are supported.

Set `SubmitRequest.WebhookURL` for callbacks. `VerifyWebhookSignature` takes `Secret`, `ID`, `Timestamp`, `Signature` and `RawBody`. Use the account Webhook secret, not the API key, and exact bytes captured before JSON parsing. Map the delivery's signature metadata into those fields. Default clock tolerance is 300 seconds. Check both the returned error and `Valid`; durably deduplicate by Webhook ID and settle once even when polling also observes the terminal job.

## Pricing and contracts

`GetModelPrices` retrieves validated model prices. Cache by account/policy/model/operation/input mode/filter and respect expiry. Local pricing helpers consume tables without network calls. Preserve decimal strings and table scale; estimates, holds and static model metadata are not final billing or guaranteed live supply. A missing price row is not a free price or proof of unsupported input. Customer retail pricing, balances and authorization remain separate from Yir procurement cost. See [pricing examples](pricing_example_test.go) and [public contracts](https://github.com/yir-ai/sdk/blob/main/spec/README.md).

## Contract update (unreleased)

H3 reference input accepts 1–15 references: up to 9 images, 3 videos and 3 audio files, including audio-only input, preserving URLs and order. Image-to-video remains adaptive-only. Current channel supply still permits only the existing 1–5 images; video, audio or a sixth image does not imply authorized supply, verified pricing or trusted media duration.

Job results may include `result.warnings: ["additional_results_unavailable"]` when the primary result was delivered but an optional additional result was not. The job remains `succeeded` and `files` contains only delivered files. Normal and historical responses may omit warnings; expired results may retain historical warnings. This is not generation failure, does not authorize automatic regeneration, and does not change charges or `parameter_notices`.

Seedance 2.0 accepts optional boolean `return_last_frame` (default false); other models reject it. Requesting a last frame requires a valid quote covering its full cost, not ordinary video pricing. Actual last-frame delivery remains unverified.

Seedream 5.0 text and image contracts now accept `4K`; image input allows up to 14 references. Other parameters are unchanged. This contract update does not establish live 4K availability, pricing or exact output dimensions; those remain subject to server integration and quotes.

This working revision accepts optional boolean `web_search` and `image_search` in Nano Banana 2 `Parameters` for text and image input. Both default to false; image search requires web search. Nano Banana Pro accepts only optional boolean `web_search` (default false) for text and image input; it rejects `image_search`, including explicit false. All other models reject both fields. Provider search execution remains to be verified; this metadata update does not change prices or enable supply. The validator preserves the request and enforces per-role reference counts, required alternatives, output-duration limits and duplicate-reference rejection. Search availability and charges require a supported supply and a valid quote. These updates are not in the published `v0.1.0` module.

## Verify

From this directory, run `go test -p 2 ./...` with `GOWORK=off` and `GOMAXPROCS=2` for isolated module verification. Examples without an `Output` directive are compiled but not executed. Optional external price-fixture tests skip when their input is absent. No Node installation is needed.
