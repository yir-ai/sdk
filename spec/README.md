# Public specifications

English | [简体中文](docs/zh-CN/spec.md) · [Repository](../README.md)

[openapi.json](openapi.json) describes the current public protocol. [models.json](models.json) is a reviewed historical catalog retained for explicit legacy getters and fixtures; it does not gate runtime requests. Applications update their model catalog through the API independently of SDK releases. The catalog's `schema_ref` points to `./openapi.json#/components/schemas/ModelContractCatalog`.

From `typescript/`, run `pnpm generate:model-contracts` to generate the packaged TypeScript and Go contracts, and `pnpm check:model-contracts` to detect drift. The generator consumes only public snapshots and never accesses the private server. Preserve existing bilingual model metadata, stable error codes and billing semantics.

[fixtures/](fixtures/) contains synthetic contract vectors, not live prices or user data. Go's required vectors are also packaged under `go/testdata/`, so downloaded modules can test without this directory. Optional external price fixtures retain their existing skip behavior.

The server owns exporting business definitions; this repository owns SDK generation, tests and releases from those public definitions. Cross-server validation remains in the private repository. Static specifications do not guarantee live supply or final charges. See the [Go](../go/README.md) and [TypeScript](../typescript/README.md) guides for runtime quote and recovery behavior.

Keep translations paired with their English documents and maintain links in both directions. The Chinese repository overview lives under `spec/docs/zh-CN/` to keep the root clean; language-specific translations live under each SDK's `docs/zh-CN/`.

## Contract update procedure

1. Export `openapi.json` from the reviewed server revision. Refresh `models.json` only when intentionally updating the historical reference catalog. Record source revisions in the private handoff; copy only public snapshots here. Do not include credentials, internal endpoints, production prices or user data.
2. Review the snapshot diff before generation. Check request/response fields, required fields, model operations, defaults, validation rules, stable error codes and billing semantics. A snapshot update does not authorize changing the billing contract.
3. From `typescript/`, run `pnpm generate:model-contracts` then `pnpm check:model-contracts`. Commit the snapshots and generated TS/Go files together. Do not edit generated files manually.
4. Add focused regressions or synthetic fixtures for changed behavior. Keep Go-required vectors in `go/testdata/`. Update English and Chinese guides/examples together. Identify any application migration in the PR.
5. Run SDK checks on the final revision. Server integration tests and paid generation remain separate; public CI uses local/mock data and has no Yir credentials. State unverified integration behavior explicitly.
6. Classify release impact for each language independently. Documentation-only changes need no package release. Compatible fixes normally use a patch; during `0.x`, incompatible API changes require a minor version and migration notes. Do not move published tags or overwrite package versions. Release only with explicit authorization.

## Continuous checks and release verification

The [SDK checks workflow](../.github/workflows/ci.yml) runs on PRs, pushes to `main`, and manual dispatch. It checks generated contracts, TypeScript tests/types/browser boundaries, real archive installation, and Go in an isolated module directory without `spec/`. Node artifacts stay under `typescript/`. Go and test concurrency are limited to two; the workflow has a 15-minute timeout.

Public PR code runs on disposable GitHub-hosted runners with a read-only token, no persisted checkout credentials, and no publishing secrets. The workflow does not use `pull_request_target` or access private services. Maintainers must review workflow/dependency changes; keep GitHub's external-contributor approval requirements enabled. Do not attach the shared service host directly to public PR jobs.

The current `de-ci` runners belong to another organization and are not available to this repository. For release or other heavier validation, use a temporary **reviewed checkout** on `de-ci` and run:

```sh
bash spec/scripts/verify-release.sh
```

The script validates committed HEAD, refuses a dirty tree, runs sequential Docker containers limited to 2 CPUs/4 GiB, and prints the validated SHA. Go is tested without the surrounding repository. Temporary files are cleaned on exit; no services are started or restarted. Pre-pull the official Node/Go images through the host's approved direct download path if needed; do not change system proxy settings. Do not run unreviewed forks or PR branches on this host. Keep this as a short-lived verification checkout, not a development workspace.

Save the command results and SHA in the PR or release record. A green workflow does not publish anything: npm/Go versions, tags and release notes remain separate authorized steps. After publication, verify anonymous registry installation and the published version's identity.
