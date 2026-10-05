# TypeScript SDK changelog

Release notes before 0.10.0, moved from the README. Notes describe each release as published; later releases may supersede them. Current behavior is in the [README](README.md).

## 0.9.0 changes

0.9.0 is a minor release with incompatible changes. It removes surface that the Gateway no longer uses:

- `Quote` drops `max`, `single_attempt_upper_bound`, `has_verifiable_upper_bound` and `supply.requires_max_cost`. The Gateway still returns them as constants for older SDKs (`max` repeats `primary`; the others are `null` or `false`), and this SDK ignores them. Read `primary` for the estimate and set your own `max_cost`.
- `Job.billing.savings` is removed; the Gateway stopped returning it on 2026-10-02. Use `billing.official_comparison`.
- `checkParameterPolicies`, `ModelParameterContract.policy` and the console warnings on quote/submit are removed. Model contracts no longer carry policies; quotes and Jobs report actual handling in `parameter_notices`.
- `RoutingPreference` no longer lists `balanced`. The Gateway still accepts it as an alias of `cost`; send `cost`.
- `DEFAULT_POLL_INTERVAL_MS` is removed; set `pollIntervalMs` for a fixed interval.
- `examples/quickstart.mjs` takes the approved `max_cost` as a third argument instead of deriving it from the removed upper bound.

## 0.8.0 changes

0.8.0 is a minor release and is compatible with 0.7.0.

- `Job.result.content_safety` (type `JobResultContentSafety`) reports whether the delivered result passed an NSFW check and who ran it: `{ status: "passed", checked_by: "provider" }` when the upstream provider moderates the route, `{ status: "passed", checked_by: "yir" }` when Yir checked the output itself, or `{ status: "unchecked" }` when no check could be applied. It is absent on results delivered before the field existed. When it is `passed` you can skip your own NSFW check; otherwise apply your own policy. Yir's own output check only blocks explicit adult content. Output that fails a check is not delivered and the Job fails with `YIR_CONTENT_REJECTED`; because the upstream already generated and billed it, that upstream cost is charged.
- `RoutingPreference` adds `speed`, which orders channels by ascending observed upstream latency, with channels that have too few samples following in price order. `cost` stays the default, and `balanced` is marked deprecated as an alias of `cost` that the Gateway still accepts. The value is still validated by the Gateway, so earlier SDK versions can already send `speed` to a Gateway that supports it.

## 0.7.0 changes

0.7.0 is a minor release with incompatible changes:

- `JobStatus` and `InputFile.status` widen with `(string & {})`. Only `succeeded`, `failed` and `cancelled` end a Job, and only `ready`, `failed` and `expired` settle a file; any other non-empty status is in progress. `getJob`, `getJobStatus`, `cancelJob` and file reads accept newer statuses, `waitForJob` and `uploadFile` keep waiting through them, and the Vercel adapter reports them as `pending`. Exhaustive `switch` statements need a default branch.
- Error bodies without a code use `http_error` instead of `HTTP_<status>`, as in the Go SDK; the status stays in `YirAPIError.status`. The `YirAPIError` constructor uses the same default.
- The Node transport limits each Gateway request to 30 seconds by default (`DEFAULT_REQUEST_TIMEOUT_MS`) and rejects with a `TimeoutError`. Set `timeoutMs` for slower calls, or `0` to disable it. Recover a timed-out submit with the same request and idempotency key.
- `submitImage` and `submitVideo` reject a response that is not a Job with a valid ID and status with `response_invalid`.
- `constructWebhookEvent` reports an authentic JSON object that is not a terminal Job, such as an event type newer than the SDK, with `reason` `unsupported_event` and the delivery `id` and `timestamp`, instead of `invalid_payload`. Acknowledge it with a 2xx response and log it. `invalid_payload` now means the body is not a JSON object.
- A client created with a catalog, and the Vercel adapter, apply the catalog only to the models, operations and input modes it describes and leave others to the Gateway, instead of failing with `model_contract_unavailable`. `validateGeneration(operation, request, catalog)` and the request builders stay strict.
- A quote in a currency other than USD rejects with `quote_currency_unsupported` instead of `quote_response_invalid`, also from `quoteBatch`. Such quotes are still rejected.

Compatible additions: `YirErrorAction` is an open union for `action`, and `YirAPIError.requestId` is also kept for error bodies without a standard error object. `waitForJob` (and the Vercel adapter's image wait) long-polls by default: each status query asks the Gateway to hold it for up to 20 seconds (`statusWaitSeconds`, `0` disables) until the status changes, so a terminal Job is seen about a second after Yir records it; it stays inside the wait timeout and falls back to `pollDelayMs` when the Gateway does not hold. `getJobStatus(id, { waitSeconds })` and the transport request field `holdMs` are new; custom transports with their own request limit should extend it by `holdMs`.

## 0.6.0 changes

0.6.0 is a minor release with incompatible changes:

- Explicit `billing_mode: "actual"` is supported; see the [repository overview](https://github.com/yir-ai/sdk/blob/main/README.md) for its consent and debt terms.
- `ComputeCharge` describes only managed supply billed by Yir: `supply_type`, `billed_by` and `amount_basis` narrow to `managed`, `yir` and `yir_price_rule`, `amount` is never `null`, and `status` no longer includes `external`.

Model, parameter and pricing changes that the existing protocol can express no longer need an SDK release:

- Catalogs and model details keep fields and enum values newer than the SDK (new controls, parameter types, operations, input modes, availability or rule behaviors). Rule keys the SDK does not understand are left to the Gateway, while known rules keep their meaning and still apply; values of a newer parameter type are not checked locally. `model_contract_semantics_unsupported` is no longer thrown.
- Without a catalog, request validation checks only the protocol skeleton: object shapes, non-empty `model`, `input.type`, prompt and reference roles, `max_cost`, `billing_mode`, HTTPS `webhook_url` and routing value types. Prompt length, reference roles and sources, `file_id` format, routing provider codes, preferences and limits are Gateway checks. Unknown top-level, `input`, reference and `routing` fields pass through unchanged instead of failing with `unknown_field`.
- Quotes keep strict amounts, currency and price ordering, but accept newer price `kind`s (amount is a decimal or null), supply issues, reasons and estimate scopes/usage metrics. Batch quote items accept any error code.
- Types widen with `(string & {})` so known values keep autocompletion; `Quote.parameters` allows additional keys and `QuotePrice` adds an open variant. Exhaustive `switch` statements need a default branch.
- The Vercel adapter maps `seed` and video `fps` to same-named Yir parameters; the model contract decides whether they are accepted.

## 0.5.1

Version 0.5.1 is compatible with 0.5.0. The bundled `minimax/minimax-h3` descriptions match the current server export; no API changes.

## 0.5.0 migration

Version 0.5.0 adds `getModel` to `YirClient` and `getFileContentURL` to `YirFileClient`. Code that implements either type itself must add these methods; callers of `createYirClient` or `createNodeYirClient` need no change. `YirTransportRequest` gains an optional `redirect: "manual"`. A custom transport that ignores it keeps working for every other call, but `getFileContentURL` then rejects (with the transport's own redirect error or `file_content_response_invalid`) instead of returning a URL.

## 0.4.1

Version 0.4.1 is compatible with 0.4.0. `cancelJob(id, options)` accepts an abort signal and rejects a response that is not the requested job with `response_invalid`. `Quote.parameters` adds `return_last_frame`, `web_search` and `image_search`. `YIR_ERROR_CODES` and `YirErrorCode` are new, and `DEFAULT_USER_AGENT` reports the package version. The bundled model contracts match the current server export: `alibaba/qwen-image-2.1` is added, Gemini Omni accepts `duration`, `wan-2.6` allows at most 5 references, and the `kie/gemini-omni-video` alias is removed. Only validation against the bundled catalog is affected.

## Changes in 0.3.0

`waitForJob` (and the Vercel adapter's image wait) without `pollIntervalMs` now backs off with `pollDelayMs` (5s, then 10s, then 20s) instead of polling every 2 seconds. Set `pollIntervalMs` to keep a fixed interval. `DEFAULT_POLL_INTERVAL_MS` is deprecated. `constructWebhookEvent` and `YirWebhookVerificationError` are new. No call signatures change. In 0.3.1, `constructWebhookEvent` also rejects Job IDs that `getJob` would reject, and `pollDelayMs` documents `poll` as the zero-based index of the query that just completed. In 0.3.2, request builders count the 20,000-character prompt limit in Unicode code points, so prompts with emoji are no longer rejected early.

## Contract updates in 0.2.0

H3 reference input accepts 1–15 references: up to 9 images, 3 videos and 3 audio files, including audio-only input, preserving URLs and order. Image-to-video remains adaptive-only. The KIE integration verified on 2026-09-16 supports mixed references within those limits, but requires at least one image or video; audio-only input passes the public contract but is not accepted by this supply. Each video/audio clip must be 2–15 seconds, with video and audio each totaling at most 15 seconds. Video/audio references require measured, ready Files owned by the caller, supplied as `file_id`; image URLs remain supported. Quote and admission use trusted measurements, and submission checks the bound measurement snapshot. Other channels retain their own supported subsets. A valid quote covering the complete request is required; static SDK validation does not establish live availability or successful generation. The earlier 1–5-image limit describes a historical supply snapshot, not the current KIE integration.

Job results may include `result.warnings: ["additional_results_unavailable"]` when the primary result was delivered but an optional additional result was not. The job remains `succeeded` and `files` contains only delivered files. Normal and historical responses may omit warnings; expired results may retain historical warnings. This is not generation failure, does not authorize automatic regeneration, and does not change charges or `parameter_notices`.

Seedance 2.0 accepts optional boolean `return_last_frame` (default false); other models reject it. Requesting a last frame requires a valid quote covering its full cost, not ordinary video pricing. Actual last-frame delivery remains unverified.

Seedream 5.0 text and image contracts now accept `4K`; image input allows up to 14 references. Other parameters are unchanged. This contract update does not establish live 4K availability, pricing or exact output dimensions; those remain subject to server integration and quotes.

This working revision adds optional `parameters.web_search` and `parameters.image_search` for Nano Banana 2 text and image requests. Both default to false; `image_search: true` requires `web_search: true`. Nano Banana Pro accepts only optional boolean `web_search` (default false) for text and image input; it rejects `image_search`, including explicit false. All other models reject both fields. Provider search execution remains to be verified; this metadata update does not change prices or enable supply. Validation preserves the caller's parameters. Search requires an explicitly supported supply and a valid quote; static support does not establish availability or free search. This is not included in the published `0.1.0` package.

This working revision introduces `getJobStatus` (`GET /v1/jobs/{id}/status`) and migrates `waitForJob` to poll lightweight `JobStatusResponse` summaries, reading the full `Job` detail only once upon reaching terminal status (`succeeded`, `failed`, or `cancelled`). Terminal status mismatches throw an error with code `job_state_inconsistent`. `WaitForJobOptions.onPoll` now receives `JobStatusResponse` instead of `Job`, and `YirTimeoutError.lastJob` has been migrated to `lastStatus`. Wait errors (including aborts, timeouts, and transport errors) do not synthesize partial jobs. Status 404 does not silently fall back to the detail endpoint. Delivered results preserve optional `result.warnings`. These incompatible polling and error return changes are included in 0.2.0; follow the migration guide when upgrading from 0.1.0.

Reference validation also enforces the catalog's per-role counts, required alternative roles, output-duration limits and duplicate-reference rejection. Keep complete requests unchanged between quote, saved authorization and submission.
