# Yir Go SDK

> 0.2.0 protocol / 协议升级：模型参数来自 API，SDK 不再以内置模型清单限制请求；旧全量价格表与客户端计价已移除。升级前阅读 [migration guide](https://github.com/yir-ai/sdk/blob/main/typescript/docs/parameter-contracts.md)。

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

Server-side image and video API client. Requires Go 1.25+. Module: `github.com/yir-ai/sdk/go`. [MIT](LICENSE).

## Install

Run in your application's Go module:

```sh
go get github.com/yir-ai/sdk/go@v0.2.0
```

Module release tags use `go/vX.Y.Z`; this version is tagged `go/v0.2.0`. The module includes its required test vectors and works without Node or the repository's `spec/` directory.

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

Persist the returned job ID. `GetJob` queries full job details; `GetJobStatus` queries lightweight `JobStatusResponse` summaries. `WaitJob` polls status summaries every 2 seconds by default using `WaitOptions`, reading the full `Job` detail only once at terminal states and rejecting terminal status mismatches with `ErrJobStateInconsistent`. Cancel or time out its context to stop local waiting, which returns a zero-value `Job{}` and does not cancel the remote job or imply a refund. Resume with the saved ID. `JobError` contains the failed/cancelled terminal job; `APIError` contains HTTP status, code, message, retryable and action. Use stable codes for application logic.

`CancelJob` explicitly requests cancellation. Inspect cancellation status and terminal billing instead of assuming immediate success or zero charge. Apply `Billing.TotalChargedByYir` once per job, including error paths. Check `Result.Availability` and copy available result files before their URLs expire.

`CreateFiles(ctx, request, key)` creates upload plans. `UploadFile(ctx, plan, source)` uploads from an `io.ReaderAt` and completes the file; `CreateAndUploadFile(ctx, metadata, source, key)` combines the steps. Keep a stable upload key and file IDs. `GetFile` checks state; `CompleteFile` completes a manually uploaded file. Use ready files as generation references with `FileID` and the appropriate role. Single and multipart upload plans are supported.

Set `SubmitRequest.WebhookURL` for callbacks. `VerifyWebhookSignature` takes `Secret`, `ID`, `Timestamp`, `Signature` and `RawBody`. Use the account Webhook secret, not the API key, and exact bytes captured before JSON parsing. Map the delivery's signature metadata into those fields. Default clock tolerance is 300 seconds. Check both the returned error and `Valid`; durably deduplicate by Webhook ID and settle once even when polling also observes the terminal job.

## Pricing and contracts


## Contract updates in 0.2.0

H3 reference input accepts 1–15 references: up to 9 images, 3 videos and 3 audio files, including audio-only input, preserving URLs and order. Image-to-video remains adaptive-only. The KIE integration verified on 2026-09-16 supports mixed references within those limits, but requires at least one image or video; audio-only input passes the public contract but is not accepted by this supply. Each video/audio clip must be 2–15 seconds, with video and audio each totaling at most 15 seconds. Video/audio references require measured, ready Files owned by the caller, supplied as `file_id`; image URLs remain supported. Quote and admission use trusted measurements, and submission checks the bound measurement snapshot. Other channels retain their own supported subsets. A valid quote covering the complete request is required; static SDK validation does not establish live availability or successful generation. The earlier 1–5-image limit describes a historical supply snapshot, not the current KIE integration.

Job results may include `result.warnings: ["additional_results_unavailable"]` when the primary result was delivered but an optional additional result was not. The job remains `succeeded` and `files` contains only delivered files. Normal and historical responses may omit warnings; expired results may retain historical warnings. This is not generation failure, does not authorize automatic regeneration, and does not change charges or `parameter_notices`.

Seedance 2.0 accepts optional boolean `return_last_frame` (default false); other models reject it. Requesting a last frame requires a valid quote covering its full cost, not ordinary video pricing. Actual last-frame delivery remains unverified.

Seedream 5.0 text and image contracts now accept `4K`; image input allows up to 14 references. Other parameters are unchanged. This contract update does not establish live 4K availability, pricing or exact output dimensions; those remain subject to server integration and quotes.

This working revision accepts optional boolean `web_search` and `image_search` in Nano Banana 2 `Parameters` for text and image input. Both default to false; image search requires web search. Nano Banana Pro accepts only optional boolean `web_search` (default false) for text and image input; it rejects `image_search`, including explicit false. All other models reject both fields. Provider search execution remains to be verified; this metadata update does not change prices or enable supply. The validator preserves the request and enforces per-role reference counts, required alternatives, output-duration limits and duplicate-reference rejection. Search availability and charges require a supported supply and a valid quote. These updates are not in the published `v0.1.0` module.

This working revision introduces `GetJobStatus` (`GET /v1/jobs/{id}/status`) and migrates `WaitJob` to poll lightweight `JobStatusResponse` summaries, reading the full `Job` detail only once upon reaching terminal status (`succeeded`, `failed`, or `cancelled`). Terminal status mismatches return `ErrJobStateInconsistent`. `WaitOptions.OnPoll` now receives `JobStatusResponse` instead of `Job`. Wait interruptions (context cancellation, timeouts) and transport, validation, or consistency errors return a zero-value `Job{}` without synthesizing partial jobs, with `JobError` as the sole exception returning the complete failed or cancelled terminal `Job`. Status 404 does not silently fall back to the detail endpoint. Delivered results preserve optional `result.warnings`. These incompatible polling and error return changes are included in 0.2.0; follow the migration guide when upgrading from 0.1.0.

## Verify

From this directory, run `go test -p 2 ./...` with `GOWORK=off` and `GOMAXPROCS=2` for isolated module verification. Examples without an `Output` directive are compiled but not executed. Optional external price-fixture tests skip when their input is absent. No Node installation is needed.
