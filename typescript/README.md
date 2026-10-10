# Yir TypeScript SDK

> Beta (0.x). Incompatible changes ship only in minor releases, with migration notes in the README and [changelog](https://github.com/yir-ai/sdk/blob/main/typescript/CHANGELOG.md). Fields and values newer than the SDK are read as data, so new models and options do not need an SDK release.

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

One `@yir-ai/sdk` package for image and video generation. Use a Node runtime with native `fetch`, Web Crypto and `Blob` (Node 22+ is a practical baseline); development uses pnpm 10.30.1. Cloudflare Workers can import the same client from `/server` with an explicit `apiKey`; the `createNodeYirClient` name is retained for compatibility and does not require Node compatibility mode.

## Install

Install from npm:

```sh
pnpm add @yir-ai/sdk@0.10.2
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
pnpm add /absolute/path/to/sdk/typescript/.tmp/scratch/yir-ai-sdk-0.10.2.tgz
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

You can also pass `{ apiKey, baseURL, fetch, headers, userAgent, timeoutMs }`. The default base URL is `https://gateway.yir.ai`. `timeoutMs` limits each Gateway request, including reading its body, and defaults to `DEFAULT_REQUEST_TIMEOUT_MS` (30 seconds, as in the Go SDK); `0` or `Infinity` disables it, and a timeout rejects with a `TimeoutError`. A timed-out or otherwise unknown submit outcome must be recovered with the same request and idempotency key. `createYirClient(transport)` retains the explicit transport contract: implement authentication, HTTP serialization, response decoding and errors in the injected transport. It is not a browser key client. Custom transports that support `getFileContentURL` must honor `redirect: "manual"` by returning a 3xx as `{ status, location }` without following it; other transports make that call fail closed.

## Quote, authorize, persist, submit

`client.submitImage(request)` and `client.submitVideo(request)` create a random idempotency key per call. Explicit keys are trimmed and must be non-empty with no CR/LF. Submit has no hidden retries. For recovery across calls or process restarts, pass a saved key as the second argument and reuse the exact request. Server fallback within an accepted Job is independent of the client key.

Use [quickstart.mjs](examples/quickstart.mjs)'s `prepareImage(client, input, maxCost)` to build a request and quote it. It requires available supply with a priced primary estimate and returns that estimate with a request carrying your approved `max_cost`.

**Warning: a tight `max_cost` can interrupt delivery during failover.** Even after a Job is accepted, a failed channel may need to be replaced by a more expensive one. If its estimate exceeds the remaining budget after earlier billed attempts, Yir skips it; if no eligible fallback fits, the Job fails with `YIR_BUDGET_EXCEEDED` and may deliver no result. When delivery continuity is more important than a per-Job spending cap, omit this optional field; otherwise leave room for more expensive fallback channels and earlier attempts' charges. Omitting it removes the per-Job cap, so actual charges can exceed the quote; account balance and other limits still apply.

Yir also applies an automatic settlement fuse to standard requests with a frozen estimate, including requests without `max_cost`. For a successful attempt, before settlement, a confirmed charge more than 3 times the frozen estimate and at least US$0.02 above it is reduced to the estimate (subject to your lower remaining cap), with Yir absorbing the excess; successful delivery can continue. If the attempt failed, Yir absorbs the anomalous charge instead. The affected route group is temporarily paused for later attempts. This is extreme-deviation protection, not a price lock; ordinary increases can still be charged. Explicit `billing_mode: "actual"` has no estimate-based fuse. See [billing protection](https://yir.ai/docs/concepts/billing#automatic-protection-against-extreme-charge-deviations).

Billing: the balance is not frozen. Every attempt the upstream actually bills is charged at its authoritative upstream amount after the managed discount, including failed attempts and attempts followed by a fallback; attempts the upstream never billed, and Yir's own delivery failures and outcome timeouts, cost nothing. `max_cost` caps the Job's total charge and skips routes whose estimate exceeds it. The quote's primary price is an estimate, not a ceiling. Prices can change after you quote: a cheaper channel can go offline or cool down, a routing default can change which channels are eligible, or a catalog price can change. Use `max_cost` as a guard against runaway charges with headroom over the quote, not as a price lock; a cap set to the quote can start failing with `YIR_BUDGET_EXCEEDED` (422 at submit, naming the lowest current estimate, or on the Job). On that error, quote again and let your application decide whether to raise the cap on a new request; do not raise it automatically. Explicit `billing_mode: "actual"` (KIE/APIMart Kling 2.6/3.0 Motion Control and FAL FLUX 2 Pro image editing only) requires `routing.only`, cannot be combined with `max_cost` and has no ceiling; amounts the balance cannot cover become debt, repaid by a later manual top-up, that blocks new Jobs. Persist that customer consent with the exact request and idempotency key.

Your application must approve the budget and durably save `{ request, idempotencyKey }` before calling `submitSavedImage(client, saved)`. Store all request fields, including parameters, references, routing, budget and any Webhook URL. Generate the key once per intended operation; never generate a new key inside a retry. The helpers do not implement a database, customer balance checks or approval.

For video, use `quoteVideo(request)` and `submitVideo(savedRequest, savedKey)` with the same lifecycle. A quote alone does not submit a job. Check quote expiry before accepting new work. After an ambiguous submit outcome, do not replace the saved request with a fresh quote or modified budget: recover the original operation first.


## Jobs and recovery

Persist the returned `job.id`. `getJob(id)` queries full job details; `getJobStatus(id)` queries lightweight `JobStatusResponse` summaries. Use `waitForJob(id, options)` on the Node client or `waitForJob(client, id, options)` with a transport client. Each status query long-polls by default: `getJobStatus(id, { waitSeconds })` lets the Gateway hold it until the status changes (at most 30 seconds), and `waitForJob` uses `statusWaitSeconds` (default 20, kept inside the timeout; 0 disables), so a terminal Job is seen about a second after Yir records it, without a Webhook. When a Gateway answers without holding, it falls back to the `pollDelayMs` backoff (5s for the first 30 seconds, 10s until about 90 seconds, then 20s; set `pollIntervalMs` for a fixed interval). A `429 YIR_RATE_LIMITED` status query (per-API-key requests per minute) is waited out per `Retry-After` (`YirAPIError.retryAfterMs`, default 1s, capped at 1 minute), up to 5 times in a row. The default timeout is 5 minutes; querying status summaries and reading full job details only once at terminal states, rejecting terminal status mismatches with `job_state_inconsistent`. `YirTimeoutError` retains `jobId` and `lastStatus`; timeouts and aborts stop local waiting and do not cancel the job or imply a refund. Resume with the saved ID. If submission returned no ID, resubmit the exact saved request and key.

`YirJobError` contains the failed/cancelled terminal job. `YirAPIError` exposes status, code, retryable, action and requestId where available. An error body without a code uses `http_error` (as in the Go SDK; earlier versions used `HTTP_<status>`), with the HTTP status in `status`. `action` may carry values newer than the SDK (`YirErrorAction`). `submitImage` and `submitVideo` reject a response that is not a Job with a valid ID and status with `response_invalid`. Keep error codes stable in application logic; `YIR_ERROR_CODES` and the `YirErrorCode` type list the stable codes. `cancelJob(id, options)` explicitly requests cancellation; inspect the returned cancellation and terminal billing instead of assuming immediate cancellation or zero charge. Reconcile `billing.total_charged_by_yir` once per job. Result URLs expire; inspect `result.availability` and copy files to your own asset store while available.

## Model detail

`getModel("creator/model")` reads the Market `ModelDetail`: `specifications` with per-channel `channels` display prices (`amount_micros` is absent when no price is published) and optional `channel_parameters`. Pass the canonical ID; aliases are not resource paths, and an invalid ID fails locally with `model_request_invalid`. Unknown fields are kept, but a mismatched ID or invalid required values fail with `model_response_invalid`. A missing model rejects with `YirAPIError` 404 `YIR_MODEL_NOT_FOUND`. Market prices are for display only; quote before submitting. `getModelContract` remains the versioned parameter contract (`view=contract`). `modelDetailPath` and `parseModelDetail` are also exported for custom transports.

A client created with a catalog (`createYirClient(transport, catalog)` or `modelContracts`) validates parameters and references only for the models, operations and input modes that catalog describes. Anything else, such as a model published after the catalog was read, gets protocol checks only and is left to the Gateway, so refresh the catalog with `getModelContracts` when you need local checks for new models. The Vercel adapter behaves the same way. `validateGeneration(operation, request, catalog)` and the request builders stay strict and reject a model outside the catalog with `model_contract_unavailable`; call them yourself to limit requests to that catalog.

## Files and Webhooks

A media reference carries exactly one of `file_id` (a ready File) or `url` (a public HTTPS URL that Yir imports at submission, up to 100 MiB; data URLs are refused). Use Files for larger media or media that is not publicly reachable. `completeFile` may return `processing`; `uploadFile` waits for `ready` with a five-minute default timeout, and `waitForFileReady` can resume waiting for a saved file ID. A waiting timeout does not cancel server analysis. The AI SDK adapter accepts inline bytes for upload; download URL inputs in your application before passing their bytes to the adapter.

`createFiles(request, key)` creates upload plans; `uploadFile(client, plan, blob)` uploads and completes a plan. `createAndUploadFile(client, metadata, blob, key)` combines the steps. Use stable upload keys and retain returned file IDs; `getFile(id)` checks state and `completeFile(id)` completes a manually uploaded file. Only reference ready files in generation requests (`file_id` plus the appropriate role). Upload helpers support the server's single/multipart plans.

`getFileContentURL(id)` resolves to the short-lived signed URL of a ready file. The Node transport reads it from the 307 `Location` header with `redirect: "manual"` and never follows it, so the API key is never sent to storage. Fetch the URL without Gateway credentials and ask again once it expires. Only an absolute `https` URL is accepted. Anything else rejects with `file_content_response_invalid`, and errors never include the URL. Missing files reject with `YirAPIError` 404 `YIR_FILE_NOT_FOUND`. Files not yet ready reject with 409 `YIR_FILE_NOT_READY` (wait with `waitForFileReady`, then retry). Expired files reject with 410 `YIR_FILE_EXPIRED` (upload them again).

Set `webhook_url` on a submit request. Verify with `verifyWebhookSignature({ secret, id, timestamp, signature, rawBody })` using the account's Webhook secret, not its API key. Pass the original request bytes before parsing JSON and map the delivery signature metadata into `id`, `timestamp` and `signature`. The default clock tolerance is 300 seconds. Reject invalid results, durably deduplicate by Webhook ID, and apply terminal settlement once even if polling also observes it. `constructWebhookEvent` verifies the same fields and resolves to `{ id, timestamp, job }`, or rejects with `YirWebhookVerificationError` carrying a stable `reason`. `unsupported_event` means the signature is valid but the body is not a terminal Job this SDK understands, such as an event type newer than the SDK; acknowledge it with a 2xx response, log it and deduplicate by its `id`. Answer other reasons with a 4xx response. Durable workflows can treat a webhook as a wake-up signal, read the job with `getJob`, and keep `pollDelayMs` polling as a fallback.

## Vercel AI SDK

Install the adapter's tested AI SDK generation in your application with `pnpm add ai@7.0.97`. Import `createYirAIProvider` from `@yir-ai/sdk/vercel`, then select `provider.imageModel(modelId)` or `provider.videoModel(modelId)`. This adapter targets AI SDK 7 / Provider V4, not older provider interfaces.

`providerOptions.yir.idempotencyKey` is optional, generating one key per invocation when omitted. Pass your saved key for recovery, along with `maxCost`, `parameters` and optional `routing`. Quote and approve before invoking generation: the adapter does not quote, authorize budgets or persist requests. Its image path submits, waits and downloads results. Its video path starts a job and returns a serializable operation with `jobId` and `modelId` for status recovery. Preserve the operation. Inline references use upload keys derived from the same generation key; preserve the same bytes on recovery.

Image masks, pixel `size` and video pixel resolution are unsupported; use Yir parameters for resolution. `seed` and video `fps` map to same-named Yir parameters. When the client's catalog describes the model and its contract lacks them, they are dropped with an `unsupported` warning; without a catalog the Gateway decides. Conflicting generic and Yir parameters are rejected. See [Vercel tests](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs) for executable adapter calls and supported mappings.

## 0.10.2 changes

0.10.2 is a compatible release:

- Cloudflare Workers/workerd can use the server transport, file uploads and AI SDK image downloads. Unexpected redirects are rejected without replaying requests or forwarding credentials; only the explicit file-content operation returns a signed redirect URL.

- `Quote.expected_amount` (optional decimal string) is the first channel's admission estimate: the amount Yir checks your balance, API Key monthly limit and `max_cost` against. Unlike an output-only `estimate` price it includes known input charges such as reference images and, for usage-billed channels, recent actual charges. It is absent when no channel matches or with `billing_mode` actual. Quote validation requires a decimal and rejects it without supply. Prefer it over `primary.amount` as a cost reference; it is not a ceiling.

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
- When the client's catalog describes the model, the Vercel adapter drops `seed` and video `fps` that its contract lacks, with an `unsupported` warning as AI SDK providers do, instead of failing at the Gateway. Without a catalog they are sent and the Gateway decides.
- Veo 3.0 (`google/veo-3.0-generate-001`) and the Gemini Omni preview (`google/gemini-omni-video`) are retired: they are gone from the API catalog and from the reviewed snapshot that earlier versions bundled. Requests for them return `YIR_INVALID_REQUEST` with `details[0].reason` `retired` and the replacement model in `allowed`.
- Gateway changes released together with this SDK: `parameters` is required; top-level `resolution`, `aspect_ratio`, `n`, `duration` and `generate_audio`, `input.image`, and case-variant `input.type` or reference roles are rejected; `resolution` and `aspect_ratio` must use a model contract value (case-insensitive), so `1024`, `2048x2048` or `16x9` are rejected. Model aliases are reduced to the short name, the vendor model ID and, where one exists, the Vercel AI Gateway ID; prefer canonical IDs such as `bytedance/seedance-2.0`.

Earlier release notes are in the [changelog](https://github.com/yir-ai/sdk/blob/main/typescript/CHANGELOG.md).

## Verify and maintain

From this directory, `pnpm check` checks generated contracts, tests, types, browser boundaries and installation from an actual package archive. Use `pnpm generate:model-contracts` and `pnpm check:model-contracts` for the public snapshots. Keep Node artifacts in this directory. [MIT license](LICENSE).
