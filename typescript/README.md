# Yir TypeScript SDK

English | [简体中文](docs/zh-CN/README.md) · [Repository](https://github.com/yir-ai/sdk) · [Examples](examples/README.md)

One `@yir-ai/sdk` package for image and video generation. Use a Node runtime with native `fetch`, Web Crypto and `Blob` (Node 22+ is a practical baseline); development uses pnpm 10.30.1.

## Install

Install from npm:

```sh
pnpm add @yir-ai/sdk@0.1.0
```

To build a local archive instead, from a checkout of this repository:

```sh
cd typescript
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination ./artifacts
```

Then, in your application's directory, install the archive (adjust the absolute path):

```sh
pnpm add /absolute/path/to/sdk/typescript/artifacts/yir-ai-sdk-0.1.0.tgz
```

Do not install the repository root as a Node package. The package is ESM.

## Entry points

| Import | Use |
| --- | --- |
| `@yir-ai/sdk/server` | `createNodeYirClient`, custom transport client, jobs, files, Webhook verification |
| `@yir-ai/sdk/browser` | Model contracts, parameter validation, request builders and pure price calculations; no network or secrets |
| `@yir-ai/sdk/shared` | Shared types and pure logic |
| `@yir-ai/sdk/vercel` | Server-side Vercel AI SDK 7 / Provider V4 adapter |

Server and browser depend on shared; shared does not depend on either. The root entry remains a compatible server entry. `pricing` and `model-contracts` subpaths remain available. Prefer explicit server/browser imports for new code. Never send a Yir Key to the browser; the key client rejects browser execution without an override switch. Have your browser call your own authenticated backend.

```ts
import { createNodeYirClient } from '@yir-ai/sdk/server';
import { calculatePrice, getModelContract } from '@yir-ai/sdk/browser';
import type { Job } from '@yir-ai/sdk/shared';

// Reads YIR_API_KEY; YIR_BASE_URL optionally overrides the default gateway.
const client = createNodeYirClient();
```

You can also pass `{ apiKey, baseURL, fetch, headers, userAgent }`. The default base URL is `https://gateway.yir.ai`. `createYirClient(transport)` retains the explicit transport contract: implement authentication, HTTP serialization, response decoding and errors in the injected transport. It is not a browser key client.

## Quote, authorize, persist, submit

Use [quickstart.mjs](examples/quickstart.mjs)'s `prepareImage(client, input)` to build a request and quote it. It requires available supply, a fixed primary price and a verifiable upper bound, and returns a request containing `max_cost`. This is a conservative example policy, not a change to the API's supported quote kinds.

Your application must approve the budget and durably save `{ request, idempotencyKey }` before calling `submitSavedImage(client, saved)`. Store all request fields, including parameters, references, routing, budget and any Webhook URL. Generate the key once per intended operation; never generate a new key inside a retry. The helpers do not implement a database, customer balance checks or approval.

For video, use `quoteVideo(request)` and `submitVideo(savedRequest, savedKey)` with the same lifecycle. A quote alone does not submit a job. Check quote expiry before accepting new work. After an ambiguous submit outcome, do not replace the saved request with a fresh quote or modified budget: recover the original operation first.

Prices are decimal strings. A local price preview, output-only estimate or held budget is not final billing. `getModelPrices(model, operation, inputMode, options)` loads validated prices; cache by account/policy/model/operation/input mode/filter and respect expiry. Browser `calculatePrice` uses the supplied table without fetching. Keep retail pricing separate from Yir cost; missing rows are not free prices or proof that a model is unsupported.

## Jobs and recovery

Persist the returned `job.id`. Use `getJob(id)`, `waitForJob(id, options)` on the Node client, or `waitForJob(client, id, options)` with a transport client. Polling defaults to 2 seconds and a 5-minute timeout. `YirTimeoutError` retains the job ID; timeouts and aborts stop local waiting and do not cancel the job or imply a refund. Resume with the saved ID. If submission returned no ID, resubmit the exact saved request and key.

`YirJobError` contains the failed/cancelled terminal job. `YirAPIError` exposes status, code, retryable, action and requestId where available. Keep error codes stable in application logic. `cancelJob(id)` explicitly requests cancellation; inspect the returned cancellation and terminal billing instead of assuming immediate cancellation or zero charge. Reconcile `billing.total_charged_by_yir` once per job. Result URLs expire; inspect `result.availability` and copy files to your own asset store while available.

## Files and Webhooks

`createFiles(request, key)` creates upload plans; `uploadFile(client, plan, blob)` uploads and completes a plan. `createAndUploadFile(client, metadata, blob, key)` combines the steps. Use stable upload keys and retain returned file IDs; `getFile(id)` checks state and `completeFile(id)` completes a manually uploaded file. Only reference ready files in generation requests (`file_id` plus the appropriate role). Upload helpers support the server's single/multipart plans.

Set `webhook_url` on a submit request. Verify with `verifyWebhookSignature({ secret, id, timestamp, signature, rawBody })` using the account's Webhook secret, not its API key. Pass the original request bytes before parsing JSON and map the delivery signature metadata into `id`, `timestamp` and `signature`. The default clock tolerance is 300 seconds. Reject invalid results, durably deduplicate by Webhook ID, and apply terminal settlement once even if polling also observes it.

## Vercel AI SDK

Install the adapter's tested AI SDK generation in your application with `pnpm add ai@7.0.97`. Import `createYirAIProvider` from `@yir-ai/sdk/vercel`, then select `provider.imageModel(modelId)` or `provider.videoModel(modelId)`. This adapter targets AI SDK 7 / Provider V4, not older provider interfaces.

Every generation call requires `providerOptions.yir.idempotencyKey`; pass your saved `maxCost`, `parameters` and optional `routing` there too. Quote and approve before invoking generation: the adapter does not quote, authorize budgets or persist requests. Its image path submits, waits and downloads results. Its video path starts a job and returns a serializable operation with `jobId` and `modelId` for status recovery. Preserve the operation. Inline references are uploaded with keys derived from the saved generation key; preserve the same bytes on recovery.

Image masks, pixel `size`, seed, video pixel resolution and fps are unsupported. Use Yir parameters for resolution. Conflicting generic and Yir parameters are rejected. See [Vercel tests](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs) for executable adapter calls and supported mappings.

## Contract update (unreleased)

Seedream 5.0 text and image contracts now accept `4K`; image input allows up to 14 references. Other parameters are unchanged. This contract update does not establish live 4K availability, pricing or exact output dimensions; those remain subject to server integration and quotes.

This working revision adds optional `parameters.web_search` and `parameters.image_search` for Nano Banana 2 text and image requests. Both default to false; `image_search: true` requires `web_search: true`. Other models reject these fields, including explicit false. Validation preserves the caller's parameters. Search requires an explicitly supported supply and a valid quote; static support does not establish availability or free search. This is not included in the published `0.1.0` package.

Reference validation also enforces the bundled per-role counts, required alternative roles, output-duration limits and duplicate-reference rejection. Keep complete requests unchanged between quote, saved authorization and submission.

## Verify and maintain

From this directory, `pnpm check` checks generated contracts, tests, types, browser boundaries and installation from an actual package archive. Use `pnpm generate:model-contracts` and `pnpm check:model-contracts` for the public snapshots. Keep Node artifacts in this directory. [MIT license](LICENSE).
