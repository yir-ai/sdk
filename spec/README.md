# Public specifications

English | [简体中文](docs/zh-CN/spec.md) · [Repository](../README.md)

[openapi.json](openapi.json) and [models.json](models.json) are public protocol snapshots exported together from the same server revision. The model catalog's `schema_ref` points to `./openapi.json#/components/schemas/ModelContractCatalog`; preserve that reference when updating files.

From `typescript/`, run `pnpm generate:model-contracts` to generate the packaged TypeScript and Go contracts, and `pnpm check:model-contracts` to detect drift. The generator consumes only public snapshots and never accesses the private server. Preserve existing bilingual model metadata, stable error codes and billing semantics.

[fixtures/](fixtures/) contains synthetic contract vectors, not live prices or user data. Go's required vectors are also packaged under `go/testdata/`, so downloaded modules can test without this directory. Optional external price fixtures retain their existing skip behavior.

The server owns exporting business definitions; this repository owns SDK generation, tests and releases from those public definitions. Cross-server validation remains in the private repository. Static specifications do not guarantee live supply or final charges. See the [Go](../go/README.md) and [TypeScript](../typescript/README.md) guides for runtime quote and recovery behavior.

Keep translations paired with their English documents and maintain links in both directions. The Chinese repository overview lives under `spec/docs/zh-CN/` to keep the root clean; language-specific translations live under each SDK's `docs/zh-CN/`.
