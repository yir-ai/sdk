# Yir SDK

> Beta (0.x). Incompatible changes ship only in minor releases, with migration notes in each SDK's README and changelog.

English | [简体中文](spec/docs/zh-CN/README.md)

Official Go and TypeScript SDKs for the Yir image and video API. Public source: [yir-ai/sdk](https://github.com/yir-ai/sdk). Licensed under [MIT](LICENSE).

| Package | Start here | Scope |
| --- | --- | --- |
| Go | [Go guide](go/README.md) | Server client, quotes, jobs, files and Webhooks |
| TypeScript | [TypeScript guide](typescript/README.md) | One `@yir-ai/sdk` package with server, browser and shared entry points; Vercel AI SDK adapter |
| Specification | [Public contracts](spec/README.md) | OpenAPI, model contracts, fixtures and generation tools |

## Install

Go 1.25 or later, from your application's module:

```sh
go get github.com/yir-ai/sdk/go@v0.10.0
```

Install TypeScript with `pnpm add @yir-ai/sdk@0.9.0`. See the [TypeScript guide](typescript/README.md#install) for entry points and local archive installation.

## Safe generation lifecycle

The generation idempotency key is optional: the SDKs create a new random key per call when it is omitted. Submit is issued once. Recovery across calls/processes requires the same caller-persisted key and exact request. Server fallback within an accepted Job is independent of this header.

1. Build an explicit request and obtain a quote. Check supply; the primary price is an estimate, not a ceiling.
2. Have your application approve the budget. Persist the exact submit request, including `max_cost`, and a stable idempotency key before submitting.
3. Submit the saved request. If the outcome is unknown, recover with the same request and key. Once known, persist the job ID and resume polling by that ID.
4. Reconcile terminal billing once and copy available result files before their URLs expire.

A quote or static price table does not authorize a purchase or guarantee current supply or final billing. Customer pricing, account authorization, balances and persistence belong to your application. Keep Yir API keys on the server; the browser entry exposes only pure helpers and types.

Every attempt the upstream actually bills is charged at its authoritative upstream amount after the managed discount, including failed attempts and attempts followed by a fallback; attempts the upstream never billed, and Yir's own delivery failures and outcome timeouts, cost nothing. `max_cost` caps the Job's total charge. Explicit `billing_mode: "actual"` (`BillingMode: "actual"` in Go) requires `routing.only`, cannot be combined with `max_cost` and supports only KIE/APIMart Kling 2.6/3.0 Motion Control and FAL FLUX 2 Pro image editing. It has no ceiling; insufficient funds become wallet debt repaid by a later manual top-up, and outstanding debt blocks new Jobs. Persist this customer consent with the exact request and idempotency key.

`routing.preference` orders the eligible channels: `cost` (default) by ascending price, `speed` by ascending observed upstream latency, with channels that have too few samples following in price order. The SDKs pass the value through and leave validation to the Gateway.

See the [TypeScript examples](typescript/examples/README.md) and [Go example guide](go/examples/README.md) for the full workflow.

## Development

Run Node commands only inside `typescript/`:

```sh
cd typescript
pnpm install --frozen-lockfile
pnpm check
```

From `go/`, run `go test -p 2 ./...` with `GOWORK=off` and `GOMAXPROCS=2` when testing this module in isolation. Go includes its required test fixtures and does not need Node or the root `spec/` directory. External price-fixture tests may skip when their optional input is absent.

Keep the root limited to `go/`, `typescript/`, `spec/`, this README, LICENSE and necessary Git files. Node dependencies, configuration, locks and build artifacts belong under `typescript/`. See [contract maintenance](spec/README.md) for snapshot generation. Go releases use `go/vX.Y.Z` tags; TypeScript versions are managed in its own `package.json`. Publication and release tags are separate operations.
