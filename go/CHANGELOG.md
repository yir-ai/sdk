# Go SDK changelog

Release notes, newest first. Notes describe each release as published; later releases may supersede them. Current behavior is in the [README](README.md).

## Unreleased

Compatible additions:

- `SubmissionNotAccepted(err)` reports whether a Submit error proves that the call created no Job and left the idempotency key unused: a request the SDK refused before sending, or a 4xx rejection with a Yir error code other than `YIR_IDEMPOTENCY_CONFLICT`. Use it before releasing your own reservation or refunding your user.
- `PollJob(ctx, id, wait)` checks a Job once for applications that schedule their own polling: the light status, then the full Job only when it is terminal, with the same consistency check as `WaitJob`.
- `JobBilling.TotalChargedMicros()` and `USDMicros(amount)` convert API amounts to integer millionths of a dollar.

Behavior change:

- `CancelJob` on a Job that already succeeded or failed returns that finished Job instead of the `409 YIR_JOB_NOT_CANCELLABLE` `*APIError`. Code that handled the 409 by reading the Job again can drop that branch; code that treated a nil error as "cancelled" must read `Status`, as it already had to for a Job whose cancellation is only requested.

## Upgrading to 0.13.0

0.13.0 is a minor release and is compatible with 0.12.0. The Gateway features it relies on are already live.

Additions:

- Demo mode: `ClientOptions.Demo` (`DemoOptions`, `DemoScenario*`), `IsDemoJobID` and `DemoAssetBaseURL`. Every `Client` answers `demo_` Job IDs locally. See [Demo mode](README.md#demo-mode).
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
- `QuoteAudio` and `SubmitAudio` (originally `QuoteMusic` / `SubmitMusic`), `GenerationInput.Lyrics` and `ResultFile.DurationMS`; see [Quote and submit](README.md#quote-and-submit).
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

0.11.0 is a minor release with incompatible changes. It prepares the 1.0 contract. Upgrading from 0.9, read the [0.10.0 notes](#0100-changes) first; 0.10.0 was never published on its own and ships with this release.

- The bundled model catalog is removed: package-level `ListModelContracts`, `GetModelContract`, `GetModelOperationContract`, `ValidateGeneration` and `ValidateModelParameters` are gone. Fetch the catalog with `client.GetModelContracts` and pass it to `ValidateGenerationWithCatalog` or `ClientOptions.ModelContracts`. New models and parameter changes never need an SDK release.
- Job IDs are opaque. Any non-empty ID of up to 64 characters that is safe as one URL path segment is accepted; store it as a string and do not parse it.
- Without a catalog, a quote may echo the canonical `creator/model` ID for an alias you sent; any other different model fails validation. With a catalog the SDK compares the resolved IDs.
- `APIError.Details` (`[]ErrorDetail`) locates invalid fields of `YIR_INVALID_REQUEST`: `Field`, a stable `Reason` such as `unsupported` or `required`, and `Allowed` contract values.
- Veo 3.0 (`google/veo-3.0-generate-001`) and the Gemini Omni preview (`google/gemini-omni-video`) are retired: they are gone from the API catalog and from the reviewed snapshot that earlier versions bundled. Requests for them return `YIR_INVALID_REQUEST` with `details[0].reason` `retired` and the replacement model in `allowed`.
- Gateway changes released together with this SDK: `parameters` is required; top-level `resolution`, `aspect_ratio`, `n`, `duration` and `generate_audio`, `input.image`, and case-variant `input.type` or reference roles are rejected; `resolution` and `aspect_ratio` must use a model contract value (case-insensitive), so `1024`, `2048x2048` or `16x9` are rejected. Model aliases are reduced to the short name, the vendor model ID and, where one exists, the Vercel AI Gateway ID; prefer canonical IDs such as `bytedance/seedance-2.0`.

## 0.10.0 changes

0.10.0 was never published on its own; its changes ship with 0.11.0.

0.10.0 is a minor release with incompatible changes. It removes surface that the Gateway no longer uses:

- `Quote` drops `Max`, `SingleAttemptUpperBound` and `HasVerifiableUpperBound`, and `QuoteSupply` drops `RequiresMaxCost`. The Gateway still returns them as constants for older SDKs, and this SDK ignores them. Read `Primary` for the estimate and set your own `MaxCost`.
- `JobBilling.Savings` and the `Savings` type are removed; the Gateway stopped returning them on 2026-10-02. Use `OfficialComparison`.
- `ModelParameterContract.Policy`, the `ParameterPolicy` type and the logged warnings on quote/submit are removed. Model contracts no longer carry policies; quotes and Jobs report actual handling in `ParameterNotices`.
- `RoutingPreferenceBalanced` is removed. The Gateway still accepts `balanced` as an alias of `cost`; use `RoutingPreferenceCost`.

## 0.9.0 changes

0.9.0 is a minor release and is compatible with 0.8.0.

- `Result.ContentSafety` (`*ResultContentSafety`) reports whether the delivered result passed an NSFW check and who ran it: `Status` `"passed"` with `CheckedBy` `"provider"` when the upstream provider moderates the route or `"yir"` when Yir checked the output itself, or `Status` `"unchecked"` when no check could be applied. It is `nil` on results delivered before the field existed. When it is `passed` you can skip your own NSFW check; otherwise apply your own policy. Yir's own output check only blocks explicit adult content. Output that fails a check is not delivered and the Job fails with `YIR_CONTENT_REJECTED`; because the upstream already generated and billed it, that upstream cost is charged.
- `RoutingPreferenceCost`, `RoutingPreferenceSpeed` and the deprecated `RoutingPreferenceBalanced` name the `Routing.Preference` values. `speed` orders channels by ascending observed upstream latency, with channels that have too few samples following in price order; `cost` stays the default; `balanced` is an alias of `cost` that the Gateway still accepts. `Preference` remains a string validated by the Gateway, so earlier SDK versions can already send `speed` to a Gateway that supports it.

## 0.8.0 changes

0.8.0 is a minor release. Call signatures do not change, but these behaviours do; check code that branches on them:

- Job and file statuses newer than the SDK are accepted. Only `succeeded`, `failed` and `cancelled` end a Job, and only `ready`, `failed` and `expired` settle a file; any other non-empty status is in progress. Submit, `GetJob`, `GetJobStatus`, `CancelJob` and file reads no longer fail with `response_invalid` on a new status, and `WaitJob` keeps polling through it, so bound it with its context. A `switch` on `Status` needs a default branch.
- `WaitForFileReady`, `UploadFile` and `CreateAndUploadFile` wait on `processing` and newer statuses. `CreateAndUploadFile` previously returned `file_not_ready` for a replay that was still `processing`.
- `ConstructWebhookEvent` reports an authentic JSON object that is not a terminal Job, such as an event type newer than the SDK, with `Reason` `unsupported_event` and the delivery `ID` and `Timestamp`, instead of `invalid_payload`. Acknowledge it with a 2xx response and log it. `invalid_payload` now means the body is not a JSON object.
- A client created with `ClientOptions.ModelContracts` applies the catalog only to the models, operations and input modes it describes and leaves others to the Gateway, instead of failing with `model_contract_unavailable`. Call `ValidateGenerationWithCatalog`, which stays strict, to keep limiting requests to the catalog.
- A quote in a currency other than USD fails with `ErrQuoteCurrencyUnsupported` (`quote_currency_unsupported`) instead of `quote_response_invalid`, from `Quote.Validate`, `QuoteImage`, `QuoteVideo` and `QuoteBatch`. Such quotes are still rejected.

Compatible additions:

- `GetModel` accepts operations, input modes, currencies, availability values and rule behaviors newer than the SDK.
- `Job`, `JobStatusResponse`, `Quote`, `File` and `ModelDetail` add `RawJSON()`, which returns the JSON they were decoded from, so newer fields can be read before a release models them.
- `APIError.RequestID` carries the `request_id` of a failed HTTP request.
- `WaitJob` long-polls by default: each status query asks the Gateway to hold it for up to `DefaultStatusWait` (20s) until the status changes, so a terminal Job is seen about a second after Yir records it. It stays inside the HTTP client timeout and the context deadline, and falls back to `PollDelay` when the Gateway does not hold. Set `WaitOptions.StatusWait` below zero to disable it. `GetJobStatusWithWait` is new.

## 0.7.0 changes

0.7.0 is a minor release with incompatible changes:

- Explicit `BillingMode: "actual"` is supported; see the [repository overview](https://github.com/yir-ai/sdk/blob/main/README.md) for its consent and debt terms.
- `ComputeCharge` describes only managed supply billed by Yir: `Amount` changes from `*string` to `string`, and retired BYOK values no longer appear. Code reading `Amount` must drop the dereference.

Model, parameter and pricing changes that the existing protocol can express no longer need an SDK release:

- `GetModelContracts` and `GetModelContract` ignore fields newer than the SDK and accept new operations, input modes, parameter types and controls. Rule keys the SDK does not understand are left to the Gateway, while known rules keep their meaning and still apply; values of a newer parameter type are not checked locally.
- `ValidateGenerationProtocol`, used when no catalog is configured, checks only the protocol skeleton. Prompt length, reference sources and `file_id` format, routing provider codes, preferences and limits are Gateway checks. `GenerationRequest.Extra` sends top-level fields newer than the SDK and is restored when a persisted request is unmarshaled. Fields the SDK models (`model`, `input`, `parameters`, `routing`, `billing_mode`, `max_cost`, `webhook_url`) are rejected in `Extra` with `reserved_field` and never sent from it.
- `Quote.Validate` keeps amounts, currency and price ordering strict, but accepts newer price kinds (amount is a decimal or nil), supply issues, reasons and estimate scopes/usage metrics. `QuoteBatch` items accept any error code.
- `ValidateGeneration` and `ValidateModelParameters` are deprecated: they use the historical bundled catalog. Use `ValidateGenerationWithCatalog` with current `GetModelContracts` data.

## 0.6.1

Version 0.6.1 is compatible with 0.6.0. `GetModel` now fails with `model_response_invalid` when a channel price omits `estimated` or a channel parameter entry omits `parameter_rules`, instead of reading them as `false` or empty. The bundled `minimax/minimax-h3` descriptions match the current server export.

## 0.5.1

Version 0.5.1 is compatible with 0.5.0. `Job` adds `FinalProvider`, `URLs` and `Usage`; `JobBilling` adds `ComputeCharges`, `GatewayFee`, `Savings` and `OfficialComparison`. `ErrCode*` constants and `Version` are new, and the User-Agent now reports the SDK version. The bundled model contracts match the current server export: `alibaba/qwen-image-2.1` is added, Gemini Omni accepts `duration`, `wan-2.6` allows at most 5 references, and the `kie/gemini-omni-video` alias is removed. Only explicit bundled-contract validators are affected; runtime requests without a caller catalog are unchanged. Check `Result.Availability` and copy available result files before their URLs expire.

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

## Contract updates in 0.2.0

H3 reference input accepts 1–15 references: up to 9 images, 3 videos and 3 audio files, including audio-only input, preserving URLs and order. Image-to-video remains adaptive-only. The KIE integration verified on 2026-09-16 supports mixed references within those limits, but requires at least one image or video; audio-only input passes the public contract but is not accepted by this supply. Each video/audio clip must be 2–15 seconds, with video and audio each totaling at most 15 seconds. Video/audio references require measured, ready Files owned by the caller, supplied as `file_id`; image URLs remain supported. Quote and admission use trusted measurements, and submission checks the bound measurement snapshot. Other channels retain their own supported subsets. A valid quote covering the complete request is required; static SDK validation does not establish live availability or successful generation. The earlier 1–5-image limit describes a historical supply snapshot, not the current KIE integration.

Job results may include `result.warnings: ["additional_results_unavailable"]` when the primary result was delivered but an optional additional result was not. The job remains `succeeded` and `files` contains only delivered files. Normal and historical responses may omit warnings; expired results may retain historical warnings. This is not generation failure, does not authorize automatic regeneration, and does not change charges or `parameter_notices`.

Seedance 2.0 accepts optional boolean `return_last_frame` (default false); other models reject it. Requesting a last frame requires a valid quote covering its full cost, not ordinary video pricing. Actual last-frame delivery remains unverified.

Seedream 5.0 text and image contracts now accept `4K`; image input allows up to 14 references. Other parameters are unchanged. This contract update does not establish live 4K availability, pricing or exact output dimensions; those remain subject to server integration and quotes.

This working revision accepts optional boolean `web_search` and `image_search` in Nano Banana 2 `Parameters` for text and image input. Both default to false; image search requires web search. Nano Banana Pro accepts only optional boolean `web_search` (default false) for text and image input; it rejects `image_search`, including explicit false. All other models reject both fields. Provider search execution remains to be verified; this metadata update does not change prices or enable supply. The validator preserves the request and enforces per-role reference counts, required alternatives, output-duration limits and duplicate-reference rejection. Search availability and charges require a supported supply and a valid quote. These updates are not in the published `v0.1.0` module.

This working revision introduces `GetJobStatus` (`GET /v1/jobs/{id}/status`) and migrates `WaitJob` to poll lightweight `JobStatusResponse` summaries, reading the full `Job` detail only once upon reaching terminal status (`succeeded`, `failed`, or `cancelled`). Terminal status mismatches return `ErrJobStateInconsistent`. `WaitOptions.OnPoll` now receives `JobStatusResponse` instead of `Job`. Wait interruptions (context cancellation, timeouts) and transport, validation, or consistency errors return a zero-value `Job{}` without synthesizing partial jobs, with `JobError` as the sole exception returning the complete failed or cancelled terminal `Job`. Status 404 does not silently fall back to the detail endpoint. Delivered results preserve optional `result.warnings`. These incompatible polling and error return changes are included in 0.2.0; follow the migration guide when upgrading from 0.1.0.
