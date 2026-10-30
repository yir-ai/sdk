# Yir TypeScript SDK

> Beta (0.x). Incompatible changes ship only in minor releases, with migration notes in the README and [changelog](https://github.com/yir-ai/sdk/blob/main/typescript/CHANGELOG.md). Fields and values newer than the SDK are read as data, so new models and options do not need an SDK release.

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

One `@yir-ai/sdk` package for image and video generation. Use a Node runtime with native `fetch`, Web Crypto and `Blob` (Node 22+ is a practical baseline); development uses pnpm 10.30.1. Cloudflare Workers can import the same client from `/server` with an explicit `apiKey`; the `createNodeYirClient` name is retained for compatibility and does not require Node compatibility mode.

`parameters.n` is the output count for **one API request (one Job)**. Its allowed values describe that request, not your application’s batch size. For example, a model that only accepts `n=1` can still generate four images through four separate Jobs. Keep application batch controls separate from the model’s `n` parameter; each Job has its own quote, idempotency key, status, and billing.

## Install

Install from npm:

```sh
pnpm add @yir-ai/sdk
```

For local development, build an archive from a checkout of this repository:

```sh
cd typescript
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination ./.tmp/scratch
```

Then, in your application's directory, install the archive (adjust the absolute path):

```sh
pnpm add /absolute/path/to/sdk/typescript/.tmp/scratch/yir-ai-sdk-VERSION.tgz
```

Do not install the repository root as a Node package. The package is ESM.

## Entry points

| Import | Use |
| --- | --- |
| `@yir-ai/sdk/server` | `createNodeYirClient`, custom transport client, jobs, files, Webhook verification |
| `@yir-ai/sdk/frontend` | External model contracts and parameter validation; no bundled registry, network or pricing engine |
| `@yir-ai/sdk/browser` | Catalog lookup, parameter validation, request builders; no network or secrets |
| `@yir-ai/sdk/shared` | Shared types and pure logic |
| `@yir-ai/sdk/vercel` | Server-side Vercel AI SDK 7 / Provider V4 adapter |


```ts
import { createNodeYirClient } from '@yir-ai/sdk/server';
import type { Job } from '@yir-ai/sdk/shared';

// Reads YIR_API_KEY; YIR_BASE_URL optionally overrides the default gateway.
const client = createNodeYirClient();
```

You can also pass `{ apiKey, baseURL, fetch, headers, userAgent, timeoutMs, referralCode }`. The default base URL is `https://gateway.yir.ai`. `timeoutMs` limits each Gateway request, including reading its body, and defaults to `DEFAULT_REQUEST_TIMEOUT_MS` (30 seconds, as in the Go SDK); `0` or `Infinity` disables it, and a timeout rejects with a `TimeoutError`. A timed-out or otherwise unknown submit outcome must be recovered with the same request and idempotency key. If you publish an app that others deploy with their own or their users' keys, `referralCode` sends your Yir referral code as `Yir-Referral`; Jobs count toward your referral rebate once Yir has enabled the code for partner attribution, and the header is ignored otherwise. `createYirClient(transport)` retains the explicit transport contract: implement authentication, HTTP serialization, response decoding and errors in the injected transport. It is not a browser key client. Custom transports that support `getFileContentURL` must honor `redirect: "manual"` by returning a 3xx as `{ status, location }` without following it; other transports make that call fail closed.

## Quote, authorize, persist, submit

`client.submitImage(request)` and `client.submitVideo(request)` create a random idempotency key per call. Explicit keys are trimmed and must be non-empty with no CR/LF. The built-in transport retries network failures and HTTP 502/503/504 up to three times (0.5s, 1s, 2s backoff), preserving the exact encoded body and idempotency key. Reads use the same policy. Retries share the request timeout and respect cancellation; Retry-After up to 60s is honored, and longer values are returned without retry. Other writes and terminal failed Jobs are never automatically resubmitted. For recovery across calls or process restarts, pass a saved key as the second argument and reuse the exact request. Server fallback within an accepted Job is independent of the client key.

Use [quickstart.mjs](examples/quickstart.mjs)'s `prepareImage(client, input, maxCost)` to build a request and quote it. It requires available supply with a priced primary estimate and returns that estimate with a request carrying your approved `max_cost`.

**Warning: a tight `max_cost` can interrupt delivery during failover.** Even after a Job is accepted, a failed channel may need to be replaced by a more expensive one. If its estimate exceeds the remaining budget after earlier billed attempts, Yir skips it; if no eligible fallback fits, the Job fails with `YIR_BUDGET_EXCEEDED` and may deliver no result. When delivery continuity is more important than a per-Job spending cap, omit this optional field; otherwise leave room for more expensive fallback channels and earlier attempts' charges. Omitting it removes the per-Job cap, so actual charges can exceed the quote; account balance and other limits still apply.

Billing: the balance is not frozen. Every attempt the upstream actually bills is charged at its authoritative upstream amount after the managed discount, including failed attempts and attempts followed by a fallback; attempts the upstream never billed, and Yir's own delivery failures and outcome timeouts, cost nothing. `max_cost` caps the Job's total charge and skips routes whose estimate exceeds it. The quote's primary price is an estimate, not a ceiling. Prices can change after you quote: a cheaper channel can go offline or cool down, a routing default can change which channels are eligible, or a catalog price can change. Use `max_cost` as a guard against runaway charges with headroom over the quote, not as a price lock; a cap set to the quote can start failing with `YIR_BUDGET_EXCEEDED` (422 at submit, naming the lowest current estimate, or on the Job). On that error, quote again and let your application decide whether to raise the cap on a new request; do not raise it automatically.

New requests use actual channel bills by default; no billing mode selection is needed. A channel without a reliable estimate may still be available, but cannot accept `max_cost`; choose a channel with an estimate when you need a cap. An unknown price never means free.

Your application must approve the budget and durably save `{ request, idempotencyKey }` before calling `submitSavedImage(client, saved)`. Store all request fields, including parameters, references, routing, budget and any Webhook URL. Generate the key once per intended operation; never generate a new key inside a retry. The helpers do not implement a database, customer balance checks or approval.

For video, use `quoteVideo(request)` and `submitVideo(savedRequest, savedKey)` with the same lifecycle. A quote alone does not submit a job. Check quote expiry before accepting new work. After an ambiguous submit outcome, do not replace the saved request with a fresh quote or modified budget: recover the original operation first.

For music and sound effects, use `quoteAudio(request)` and `submitAudio(savedRequest, savedKey)` (the `/v1/audio` endpoints) with the same lifecycle; `quoteMusic` / `submitMusic` are their original names, call the permanent legacy `/v1/music` paths and behave identically. You can also use a `generate_music` / `generate_sound_effect` item in `quoteBatch`. The input is text only: a `prompt` plus `lyrics` where the model takes custom lyrics; `parameters` are optional and each model accepts only what its contract declares (`n`, `duration`, `instrumental`, `lyrics_optimizer`). Vocal music needs a lyrics source the model supports: `lyrics`, `lyrics_optimizer: true` (writes lyrics from the prompt; some models add a charge shown in the quote) or `instrumental: true`; these exclude each other. ElevenLabs music takes no lyrics and is priced by `duration` (30–300 s in fixed steps, default 60); ElevenLabs sound effects (`elevenlabs/sound-effects-v2`) take a description, no lyrics and `duration` 1–22 s (default 5), and their quote reports operation `generate_sound_effect`. Suno (`suno/suno-v6`, unofficial access; Suno has no official API) returns two tracks per request (`n` is always 2). The SDK rejects shared conflicts before sending; `validateGeneration(operation, request, catalog)` also checks `n`, `duration` and the lyrics source against the model contract, and the Gateway enforces per-model text limits. Each audio file reports its measured length as `duration_ms`. A music quote echo carries no `resolution` or `aspect_ratio`, so `QuoteParameters.resolution` and `aspect_ratio` are optional in the type; image and video echoes still always include them.

Text-to-speech models (`minimax/speech-2.8-hd`, up to 10000 characters; `elevenlabs/eleven-v3`, up to 5000 characters) also use `quoteAudio` / `submitAudio`, or a `generate_speech` item in `quoteBatch`: `input.prompt` is the exact text to read aloud, and `parameters` take only `n` (1) and `voice`, a preset voice ID of the model (omit it for the model default; the voice does not change the price). There are no lyrics, `instrumental`, `lyrics_optimizer` or `duration`. The quote reports operation `generate_speech`, is priced per character of the prompt (spaces, punctuation and audio tags included) and echoes `n` and `voice`; the Job delivers one MP3 with its measured `duration_ms`.

```ts
const request = {
  model: "minimax/music-2.6",
  input: { type: "text", prompt: "A warm acoustic folk ballad", lyrics: "[Verse]\nWalking down a dusty road" },
} as const;
const quote = await client.quoteAudio(request);
const job = await client.submitAudio({ ...request, max_cost: "0.20" }, savedKey);
```


## Jobs and recovery

Persist the returned `job.id`. `getJob(id)` queries full job details; `getJobStatus(id)` queries lightweight `JobStatusResponse` summaries. Use `waitForJob(id, options)` on the Node client or `waitForJob(client, id, options)` with a transport client. Each status query long-polls by default: `getJobStatus(id, { waitSeconds })` lets the Gateway hold it until the status changes (at most 30 seconds), and `waitForJob` uses `statusWaitSeconds` (default 20, kept inside the timeout; 0 disables), so a terminal Job is seen about a second after Yir records it, without a Webhook. When a Gateway answers without holding, it falls back to the `pollDelayMs` backoff (5s for the first 30 seconds, 10s until about 90 seconds, then 20s; set `pollIntervalMs` for a fixed interval). A `429 YIR_RATE_LIMITED` status query (per-API-key requests per minute) is waited out per `Retry-After` (`YirAPIError.retryAfterMs`, default 1s, capped at 1 minute), up to 5 times in a row. The default timeout is 5 minutes; querying status summaries and reading full job details only once at terminal states, rejecting terminal status mismatches with `job_state_inconsistent`. `YirTimeoutError` retains `jobId` and `lastStatus`; timeouts and aborts stop local waiting and do not cancel the job or imply a refund. Resume with the saved ID. If submission returned no ID, resubmit the exact saved request and key.

`YirJobError` contains the failed/cancelled terminal job. `YirAPIError` exposes status, code, retryable, action and requestId where available. An error body without a code uses `http_error` (as in the Go SDK; earlier versions used `HTTP_<status>`), with the HTTP status in `status`. `action` may carry values newer than the SDK (`YirErrorAction`). `submitImage` and `submitVideo` reject a response that is not a Job with a valid ID and status with `response_invalid`. Keep error codes stable in application logic; `YIR_ERROR_CODES` and the `YirErrorCode` type list the stable codes. `cancelJob(id, options)` explicitly requests cancellation; inspect the returned cancellation and terminal billing instead of assuming immediate cancellation or zero charge. Reconcile `billing.total_charged_by_yir` once per job after `billing.status` becomes `settled`; a terminal result with `pending` billing is not a final bill. Poll `getJob` or process the independent `job.billing_settled` webhook. Deduplicate result fulfillment and billing settlement separately by job ID. Result URLs expire; inspect `result.availability` and copy files to your own asset store while available.

## Demo mode

Demo mode tests the whole generation flow without spending: `createNodeYirClient({ apiKey, demo: true })` or `createYirClient(transport, catalog, { demo: true })`. When `demo` is omitted, both turn it on with `YIR_DEMO=1` (`1` or `true`) where a process environment exists; an explicit `demo: false` wins. The client logs one warning when demo mode is on. `createYirAIProvider` passes `demo` to the client it creates; with your own `client`, turn demo mode on in that client instead (passing both throws `demo_requires_client_option`). Submits run the usual local checks and then the matching quote (`/v1/images/quotes` and so on, free), so the Gateway still validates the parameters, but the request is never submitted. The submit returns a demo Job whose ID starts with `demo_` and carries the quote's model and echoed parameters. Quotes, files, balance and model calls use the Gateway as usual, so an API Key is still required.

A demo Job keeps no state: its ID encodes the creation time, type, aspect ratio, `n`, duration, resolution and scenario, so `getJob`, `getJobStatus` (holding `waitSeconds` until the next change) and `waitForJob` give the same answer in any process or Workers instance, without a network call. Every client answers `demo_` IDs locally, also with demo mode off; `isDemoJobID(id)` tells them apart. An image is queued for 2 seconds and succeeds after 8, a video after 25 seconds, audio after 12. The result points at fixed files under `https://public.yir.ai/demo/v1/` with a DEMO badge, picked by type and the nearest aspect ratio (and 5 or 10 second video length); `width`, `height` and `duration_ms` describe the actual file, and the requested values stay in `parameters`. Copy the files like real results. Billing is always `"0"`.

`demo: { scenario }` or a `[demo:<scenario>]` marker in the prompt (which wins) picks the outcome: `ok` (default); `slow`, queued for 6 minutes (past the default `waitForJob` timeout) and succeeded after 8; `fail`, failed with `YIR_EXECUTION_FAILED` and nothing charged; `reject`, the submit throws `YirAPIError` 422 `YIR_INPUT_REJECTED` after the quote; `cancel`, ends `cancelled`. `cancelJob` on an unfinished demo Job returns it `cancelled` and on an ended one throws 409 `YIR_JOB_NOT_CANCELLABLE`; because nothing is stored, later reads follow the original timeline, so keep the Job `cancelJob` returns.

The submit returns the quote's full parameter echo; later reads of a demo Job keep only `n`, `aspect_ratio`, `resolution` and `duration`, which fit in the ID. Demo mode does not cover idempotent replay of a submit, balance, spend-limit or `max_cost` admission errors (402 and 422 `YIR_BUDGET_EXCEEDED`), Webhook delivery, partial or expired results, or fallback billing.

## Model detail

`getModel("creator/model")` reads the Market `ModelDetail`: `specifications` with per-channel `channels` display prices (`amount_micros` is absent when no price is published) and optional `channel_parameters`. Pass the canonical ID; aliases are not resource paths, and an invalid ID fails locally with `model_request_invalid`. Unknown fields are kept, but a mismatched ID or invalid required values fail with `model_response_invalid`. A missing model rejects with `YirAPIError` 404 `YIR_MODEL_NOT_FOUND`. Market prices are for display only; quote before submitting. `getModelContract` remains the versioned parameter contract (`view=contract`). `modelDetailPath` and `parseModelDetail` are also exported for custom transports.

Submission and quote clients perform protocol checks and let the Gateway validate model parameters, even when a local catalog is supplied. A stale catalog must not reject newly supported parameter values. The Vercel adapter uses the same submission checks. `validateGeneration(operation, request, catalog)` and the request builders remain explicitly strict; use them when you deliberately want to restrict requests to a catalog snapshot.

Failed submit calls expose `error.idempotencyKey`, including when the SDK generated the key. Recover with that key and the exact original request. Persist a caller-generated key before submission for crash recovery. `client.getBalance()` reads a wallet snapshot in USD decimal strings; available and total amounts can be negative after settlement. Reading balance is optional and does not authorize or gate submission.

## Parameter controls

`describeModelParameters(operation, inputMode, current, referenceRoles)` turns one operation contract into form fields: name, type, `control` hint, `required`, the current value (or the published default), `options`, numeric bounds and locales. `describeReferences(constraint, referenceRoles)` summarizes upload limits for one input mode: total and per-role minimum, maximum, count and `remaining`, which roles are required, `required_any` and `prompt_optional`. `defaultModelParameters(operation)` returns the published defaults for prefilling a form. All three are pure functions in `@yir-ai/sdk/frontend` and `@yir-ai/sdk/browser`; they read caller-supplied contracts (`client.getModelContracts()` or a `yir-models` snapshot) and never fetch, price or change the caller's values.

Only conditions the contract declares are applied. Today that is `max_duration_by_reference_role`: while such a reference is present, `duration` reports the lower `maximum` with `maximum_reason: "reference_duration_limit"`, and discrete options above it are marked `disabled` rather than removed. Other combinations are still checked by the Gateway at quote or submit; read `error.details`. A field with `type_known: false` has a type newer than this SDK; render a generic input. Prices are not part of the contract: quote the request, or keep your own price table and show only the options it prices.

```ts
import { findModelOperationContract, describeModelParameters, describeReferences } from '@yir-ai/sdk/frontend';

const operation = findModelOperationContract(catalog, 'google/nano-banana-pro', 'generate_image', 'image');
if (operation) {
  const fields = describeModelParameters(operation, 'image', form.parameters, form.references.map(r => r.role));
  const slots = describeReferences(operation.input_constraints.image!, form.references.map(r => r.role));
}
```

## Files and Webhooks

A media reference carries exactly one of `file_id` (a ready File) or `url` (a public HTTPS URL that Yir imports at submission, up to 100 MiB; data URLs are refused). Use Files for larger media or media that is not publicly reachable. `completeFile` may return `processing`; `uploadFile` waits for `ready` with a five-minute default timeout, and `waitForFileReady` can resume waiting for a saved file ID. A waiting timeout does not cancel server analysis. The AI SDK adapter uploads inline bytes and passes public HTTPS URL inputs to the Gateway for import. Mixed URL and inline inputs retain their order and reference roles; URLs are not fetched by the adapter.

Models whose reference input constraint declares `subject_references` (Kling 3.0) accept photos as characters: give `reference_image` references the same `subject` (letters, digits, `_`, starting with a letter) to group 2-4 photos into one character, and name it as `@subject` in the prompt. Once any reference has a subject, every reference must. Subject requests use the resolutions, aspect ratios, durations and audio values listed in `subject_references` instead of the operation defaults; local validation applies the same switch.

`createFiles(request, key)` creates upload plans; `uploadFile(client, plan, blob)` uploads and completes a plan. `createAndUploadFile(client, metadata, blob, key)` combines the steps. Use stable upload keys and retain returned file IDs; `getFile(id)` checks state and `completeFile(id)` completes a manually uploaded file. Only reference ready files in generation requests (`file_id` plus the appropriate role). Upload helpers support the server's single/multipart plans.

`getFileContentURL(id)` resolves to the short-lived signed URL of a ready file. The Node transport reads it from the 307 `Location` header with `redirect: "manual"` and never follows it, so the API key is never sent to storage. Fetch the URL without Gateway credentials and ask again once it expires. Only an absolute `https` URL is accepted. Anything else rejects with `file_content_response_invalid`, and errors never include the URL. Missing files reject with `YirAPIError` 404 `YIR_FILE_NOT_FOUND`. Files not yet ready reject with 409 `YIR_FILE_NOT_READY` (wait with `waitForFileReady`, then retry). Expired files reject with 410 `YIR_FILE_EXPIRED` (upload them again).

Set `webhook_url` on a submit request. Verify with `verifyWebhookSignature({ secret, id, timestamp, signature, rawBody })` using the account's Webhook secret, not its API key. Pass the original request bytes before parsing JSON and map the delivery signature metadata into `id`, `timestamp` and `signature`. The default clock tolerance is 300 seconds. Reject invalid results, durably deduplicate by Webhook ID, and apply terminal settlement once even if polling also observes it. `constructWebhookEvent` verifies the same fields and resolves to `{ id, timestamp, job }`, or rejects with `YirWebhookVerificationError` carrying a stable `reason`. `unsupported_event` means the signature is valid but the body is not a terminal Job this SDK understands, such as an event type newer than the SDK; acknowledge it with a 2xx response, log it and deduplicate by its `id`. Answer other reasons with a 4xx response. Durable workflows can treat a webhook as a wake-up signal, read the job with `getJob`, and keep `pollDelayMs` polling as a fallback.

## Vercel AI SDK

See the [core parameter compatibility matrix](docs/vercel-compatibility.md) for combinations, server-side limits and migration boundaries.

Explicit native aspect ratios retain priority over catalog inference. For video media inputs, AI SDK `aspectRatio: "adaptive"` maps to native `"auto"` when the supplied `modelContracts` declares `auto` but not `adaptive` for that model and input mode. Without a catalog, explicitly set `providerOptions.yir.parameters.aspect_ratio: "auto"` alongside `adaptive` when the model requires it; otherwise `adaptive` is forwarded unchanged. This does not fetch a catalog or change omitted defaults. Automatic duration remains a native option: `providerOptions.yir.parameters.duration: "auto"`, only for supported video-reference modes.

Install the adapter's tested AI SDK generation in your application with `pnpm add ai@7.0.97`. Import `createYirAIProvider` from `@yir-ai/sdk/vercel`, then select `provider.imageModel(modelId)` or `provider.videoModel(modelId)`; `provider.image(modelId)` and `provider.video(modelId)` are equivalent aliases. This adapter targets AI SDK 7 / Provider V4, not older provider interfaces. It is also compile- and runtime-tested with `ai@7.0.137` / `@ai-sdk/provider@4.0.26`.

`providerOptions.yir.idempotencyKey` is optional and keeps priority over a call-level `Idempotency-Key` header. Without it, the adapter uses that header (including AI SDK's video key, stable across its retries), then falls back to a random key. For image calls that may be retried by AI SDK, pass a saved key through either supported option. Pass your saved key for recovery, along with `maxCost`, `parameters` and optional `routing`. Quote and approve before invoking generation: the adapter does not quote, authorize budgets or persist requests. Its image path submits, waits and downloads results. Its video path starts a job and returns a serializable operation with `jobId` and `modelId` for status recovery. Preserve the operation. Inline references use upload keys derived from the same generation key; preserve the same bytes on recovery.

Image masks remain unsupported. Image `size` and video pixel `resolution` map unchanged to optional `parameters.size`; the Gateway rejects sizes without an explicitly compatible model/channel. `seed` and video `fps` map to same-named Yir parameters and reach the Gateway even when a local catalog lacks them. Conflicting generic and Yir parameters are rejected. See [Vercel tests](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs) for executable adapter calls and supported mappings.

When `providerOptions.yir.parameters.return_last_frame` is enabled, `videos` contains only video files. Additional outputs, such as the last-frame image, remain accessible as `providerMetadata.yir.additionalFiles` with their original Yir file fields (`url`, `media_type`, `expires_at`, and optional metadata). They are not downloaded as videos. Job result warnings, including `additional_results_unavailable`, appear in AI SDK `warnings` alongside parameter notices. Native Job `result.files` is unchanged.

Image models expose `supportsFileInputs` from the caller-provided model catalog (or `undefined` when unknown) and `supportsMaskInputs: false`. These are discovery hints, not admission checks: no catalog request is made, and a stale snapshot never blocks generation. Refresh the catalog when needed; the Gateway validates the request.

`generateVideo({ webhook })` invokes the standard webhook factory and submits its URL through `webhook_url`. Verify notifications with `constructWebhookEvent` and correlate them with the intended Job before resolving `received`. The notification only wakes a fresh read of the original Job; its body never supplies the result. Without `webhook`, polling is unchanged. First-frame video input may omit text when the Gateway model/channel declares `prompt_optional` (initially official Google Veo 3.1 only); text-only input still requires text. No prompt is synthesized. This requires the corresponding Gateway deployment.

### Parameter compatibility

| AI SDK input | Yir Standard API mapping / boundary |
| --- | --- |
| `prompt`, `aspectRatio`, `n` | `input.prompt`, `parameters.aspect_ratio`, `parameters.n`; model-specific limits still apply. |
| Video `duration`, `generateAudio` | `parameters.duration` (integer seconds), `parameters.generate_audio`; explicit `false` is preserved. |
| `seed`, video `fps` | Forwarded unchanged to the Gateway, even with a stale local catalog. Explicit `fps` requires a model/channel declaration. Initially only the official Google channel for `google/veo-3.1-generate-001` accepts native `24`; other values or undeclared channels are rejected, without interpolation or transcoding. Omitted `fps` preserves existing behavior. Requires the Gateway FPS update. |
| Image `size`, video `resolution` | Map to `parameters.size` without approximation. First supported scope: Seedream 5.0 Pro official image sizes declared by the Gateway. Video sizes currently have no declared channel and are rejected by the Gateway. Omitted size preserves existing tier defaults; explicit tier/aspect conflicts are rejected. Requires a Gateway deployment with exact-size support. |
| Image `prompt.images`, video `prompt.image` | Inline bytes/Base64 or public HTTPS URL strings. A video prompt image becomes a `first_frame` reference. |
| Video `frameImages` | Role-tagged first/last frames are preserved. AI SDK's mirrored first frame is not duplicated; `prompt.image` plus a last frame preserves both endpoints. |
| Video `inputReferences` | Image/video/audio references; URL references need explicit `mediaType` so the adapter can assign their role without downloading them. |
| Image `mask` | Unsupported; the Yir Standard API has no mask role. |
| `headers`, `abortSignal` | A call-level `Idempotency-Key` is supported; other custom per-call headers remain rejected. Configure transport headers on the client. Abort stops local work, not the server Job. |

The adapter does not automatically split `n` into separately billed Jobs. Video operation handles, Yir routing options, budgets and billing metadata are provider-specific. Basic generation calls are portable, but these fields need explicit migration when switching providers.

## Upgrading to 0.13.0

0.13.0 is a minor release with incompatible type changes. The Gateway features it relies on are already live.

Incompatible changes:

- `YirClient` adds `quoteAudio` and `submitAudio`. Code that implements `YirClient` itself must add them; callers of `createNodeYirClient` need no change.
- `Quote.operation` adds `generate_sound_effect` and `generate_speech` and widens with `(string & {})`; exhaustive `switch` statements need a default branch.

Additions:

- Demo mode: the `demo` option of `createNodeYirClient` and `createYirClient` (third argument), or `YIR_DEMO=1`; `isDemoJobID`, `YirDemoOptions`, `YirDemoScenario` and `DEMO_ASSET_BASE_URL`. Every client answers `demo_` Job IDs locally. See [Demo mode](#demo-mode).
- `quoteAudio` / `submitAudio` for the `/v1/audio` endpoints (music, sound effects and text-to-speech; `quoteMusic` / `submitMusic` stay as aliases), `StandardMusicParameters.voice`, and `generate_sound_effect` / `generate_speech` in `GenerationOperation` and `quoteBatch`.
- Reference role `keyframe` for ordered middle frames; subject references with `subject_references.mixed`, subject voices (`max_audios_per_subject`, `max_audio_only_subjects`) and video subjects (`max_videos_per_subject`, `max_video_subjects`) in model contracts and `validateGeneration`.
- `ParameterNotice.disposition` adds `exceeded` for over-delivered results.
- `createYirAIProvider` throws `demo_requires_client_option` when `demo` is passed next to an injected `client`.

## Upgrading to 0.12.0

0.12.0 is a minor release with incompatible type changes. The Gateway features it relies on are already live.

Incompatible changes:

- `YirClient` adds `quoteMusic` and `submitMusic`. Code that implements `YirClient` itself must add them; callers of `createNodeYirClient` need no change.
- `QuoteParameters.resolution` and `aspect_ratio` are optional in the type, because music quote echoes omit them. Image and video echoes still include both; narrow the type before use.

Additions:

- `quoteMusic` and `submitMusic`, the `StandardMusic*` request types, a `generate_music` item in `quoteBatch`, `JobResultFile.duration_ms`, and `QuoteParameters.instrumental` / `lyrics_optimizer`; see [Quote, authorize, persist, submit](#quote-authorize-persist-submit).
- The `referralCode` client option, sent as `Yir-Referral`.
- Account API types include routing profile `excluded_model_providers`.

## Upgrading to 0.11.0

0.11.0 is a minor release with incompatible changes. The Gateway features it relies on are already live.

Incompatible changes:

- Quote and submit clients no longer reject requests against a supplied catalog snapshot. They check the protocol skeleton and let the Gateway validate model parameters, so an invalid parameter now rejects with `YirAPIError` `YIR_INVALID_REQUEST` (fields in `error.details`) instead of `YirSDKValidationError`. Call `validateGeneration(operation, request, catalog)` when you want strict local checks.
- Vercel adapter: `seed` and video `fps` are forwarded even when the catalog lacks them, instead of being dropped with an `unsupported` warning. Image `size` and video pixel `resolution` map to `parameters.size` instead of being unsupported. The Gateway rejects values the model or channel does not declare.
- `StandardVideoImageInput.prompt` is optional: first-frame video may omit text where the model declares `prompt_optional`.
- A legacy `billing_mode: "actual"` request no longer requires `routing.only`.

Additions:

- The built-in transport retries network failures and HTTP 502/503/504 up to three times with the same body and idempotency key. A failed submit exposes `error.idempotencyKey` (`YirSubmissionError`), and `waitForJob` keeps waiting for an accepted Job through Gateway outages.
- `client.getBalance()`, and `createAccountClient` for the Account API.
- `YirPublicError.provider_error`, the `YIR_INPUT_REJECTED` code and `Job.billing.status` (`pending` or `settled`).
- Model contracts carry `string_values` (such as Seedance 2.5 duration `"auto"`, echoed in `QuoteParameters.duration`), `prompt_optional` and optional native `fps`. Market specifications with no listed channels are kept.
- Form helpers `defaultModelParameters`, `describeModelParameters` and `describeReferences`; see [Parameter controls](#parameter-controls).
- Vercel adapter: `provider.image()` and `provider.video()` aliases, `supportsFileInputs`, public HTTPS URL inputs, preserved first and last frames, webhook factories, the call-level `Idempotency-Key` header, adaptive ratio mapping, and `return_last_frame` outputs in `providerMetadata.yir.additionalFiles` with result warnings.

## 0.10.2 changes

0.10.2 is a compatible release:

- Cloudflare Workers/workerd can use the server transport, file uploads and AI SDK image downloads. Unexpected redirects are rejected without replaying requests or forwarding credentials; only the explicit file-content operation returns a signed redirect URL.

- `Quote.expected_amount` (optional decimal string) is the first channel's admission estimate: the amount Yir checks your balance, API Key monthly limit and `max_cost` against. Unlike an output-only `estimate` price it includes known input charges such as reference images and, for usage-billed channels, recent actual charges. It is absent when no channel matches or a reliable estimate is unavailable. Quote validation requires a decimal and rejects it without supply. Prefer it over `primary.amount` as a cost reference; it is not a ceiling.

## 0.10.1 changes

0.10.1 is a compatible release that follows the Gateway's parameter echo and catalog caching changes:

- `Quote.parameters` (new `QuoteParameters` type) echoes exactly the parameters the model contract declares, at contract spelling and with omitted parameters at their defaults: `duration` and `generate_audio` are now optional in the type and absent for image quotes and for video models without that parameter. Model-specific parameters are echoed under their contract names.
- `Job.parameters` carries the same echo from creation, so an application can check a delivered result against the parameters it was charged for.
- A model contract parameter's `required` now means "no published default, the request must send it"; every parameter with a `default` is `required: false` and may be omitted. `validateGeneration` already applied defaults before checking `required`, so local validation is unchanged.
- `GET /v1/models` and `view=contract` responses carry `ETag` (the quoted catalog `version`) and `Cache-Control: private, max-age=300`, and answer `If-None-Match` with 304. `getModelContracts` does not send conditional requests yet; a custom transport can.

## Upgrading to 0.10.0

0.10.0 is a minor release with incompatible changes. It prepares the 1.0 contract. Upgrading from 0.8, read the [0.9.0 notes](https://github.com/yir-ai/sdk/blob/main/typescript/CHANGELOG.md#090-changes) first; 0.9.0 was never published on its own and ships with this release.

- The bundled model catalog is removed: `listModelContracts`, `getModelContract`, `getModelOperationContract`, `KnownModelID` and the `@yir-ai/sdk/model-contracts` entry point are gone. Fetch the catalog with `client.getModelContracts()` (or generate `models.ts` from it) and use `findModelContract`, `findModelOperationContract` and `validateGeneration(operation, request, catalog)`. New models and parameter changes never need an SDK release.
- Job IDs are opaque. Any non-empty ID of up to 64 characters that is safe as one URL path segment is accepted (`isValidJobID`); store it as a string and do not parse it.
- Without a catalog, a quote may echo the canonical `creator/model` ID for an alias you sent; any other different model fails validation. With a catalog the SDK compares the resolved IDs. The Vercel video adapter no longer requires `job.model` to equal the alias it was created with.
- `YirPublicError.details` (`YirErrorDetail[]`) locates invalid fields of `YIR_INVALID_REQUEST`: `field`, a stable `reason` such as `unsupported` or `required`, and `allowed` contract values.
- `StandardMediaSource` and `StandardReference` accept `url` as well as `file_id`, as the API always did; `buildImageGenerationRequest` accepts `image: { url }`.
- In 0.10.0 the Vercel adapter dropped `seed` and video `fps` absent from a supplied catalog. 0.11.0 forwards both and leaves model validation to the Gateway.
- Veo 3.0 (`google/veo-3.0-generate-001`) and the Gemini Omni preview (`google/gemini-omni-video`) are retired: they are gone from the API catalog and from the reviewed snapshot that earlier versions bundled. Requests for them return `YIR_INVALID_REQUEST` with `details[0].reason` `retired` and the replacement model in `allowed`.
- Gateway changes released together with this SDK: `parameters` is required; top-level `resolution`, `aspect_ratio`, `n`, `duration` and `generate_audio`, `input.image`, and case-variant `input.type` or reference roles are rejected; `resolution` and `aspect_ratio` must use a model contract value (case-insensitive), so `1024`, `2048x2048` or `16x9` are rejected. Model aliases are reduced to the short name, the vendor model ID and, where one exists, the Vercel AI Gateway ID; prefer canonical IDs such as `bytedance/seedance-2.0`.

Earlier release notes are in the [changelog](https://github.com/yir-ai/sdk/blob/main/typescript/CHANGELOG.md).

## Verify and maintain

From this directory, `pnpm check` checks generated contracts, tests, types, browser boundaries and installation from an actual package archive. Use `pnpm generate:model-contracts` and `pnpm check:model-contracts` for the public snapshots. Keep Node artifacts in this directory. [MIT license](LICENSE).

New requests should omit `billing_mode`. Retrying a persisted request must keep the original body and idempotency key, including legacy `billing_mode`. Treat absent or unknown billing status as unconfirmed; do not infer settlement from a zero charge.
