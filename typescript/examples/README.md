# TypeScript examples

English | [简体中文](../docs/zh-CN/examples.md) · [TypeScript guide](../README.md)

Build first with `pnpm build` from `typescript/`. These ESM files export helpers and do not automatically call generation APIs when loaded. Import them into your server or test harness; there is no database or checkout service bundled here.

| File | Purpose |
| --- | --- |
| [quickstart.mjs](quickstart.mjs) | Quote an image, then submit/recover an application-owned saved request |

## Integrate quickstart

1. Create a server client as shown in the [guide](../README.md).
2. Call `prepareImage(client, { model, prompt, parameters })`. It only quotes and returns `{ request }` with a verified budget cap.
3. Approve the customer's budget in your backend. In durable storage, save `{ request, idempotencyKey }` under your task/order ID. If approval or persistence fails, do not submit.
4. Read that record and call `submitSavedImage(client, saved)`. Persist the returned job ID before waiting.
5. After a timeout with no job ID, repeat step 4 with exactly the saved request and key. With a known ID, resume polling instead. Reconcile billing once and copy available files.

Persistence and approval in step 3 are required integration work, not functions supplied by this example. New retries must not re-quote or create a new identity. Price previews do not authorize generation; load the trusted retail table on the server rather than accepting prices from the browser. Keep existing accepted retail orders stable when cost tables expire.

After building, focused offline verification from `typescript/`:

```sh
node --test --test-concurrency=2 tests/quickstart.test.mjs
```

Vercel integration and its limits are covered in the [guide](../README.md#vercel-ai-sdk) and [mock-backed tests](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs).
