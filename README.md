# Yir SDK

English | [简体中文](spec/docs/zh-CN/README.md)

Official Go and TypeScript SDKs for the Yir image and video API. Public source: [yir-ai/sdk](https://github.com/yir-ai/sdk). Licensed under [MIT](LICENSE).

| Package | Start here | Scope |
| --- | --- | --- |
| Go | [Go guide](go/README.md) | Server client, quotes, jobs, files and Webhooks |
| TypeScript | [TypeScript guide](typescript/README.md) | One `@yir/sdk` package with server, browser and shared entry points; Vercel AI SDK adapter |
| Specification | [Public contracts](spec/README.md) | OpenAPI, model contracts, fixtures and generation tools |

## Install

Go 1.25 or later, from your application's module:

```sh
go get github.com/yir-ai/sdk/go@v0.1.0
```

The TypeScript package is **not published to npm yet**. Build and install a local archive using the [TypeScript installation instructions](typescript/README.md#install). The GitHub repository is public; npm publication is a separate step.

## Safe generation lifecycle

1. Build an explicit request and obtain a quote. Check supply and a verifiable single-attempt upper bound.
2. Have your application approve the budget. Persist the exact submit request, including `max_cost`, and a stable idempotency key before submitting.
3. Submit the saved request. If the outcome is unknown, recover with the same request and key. Once known, persist the job ID and resume polling by that ID.
4. Reconcile terminal billing once and copy available result files before their URLs expire.

A quote or static price table does not authorize a purchase or guarantee current supply or final billing. Customer pricing, account authorization, balances and persistence belong to your application. Keep Yir API keys on the server; the browser entry exposes only pure helpers and types.

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
