# Parameter contracts (unreleased)

The SDK implements the protocol; model facts come from the API. A new model does
not require an SDK release. Without an explicit catalog, clients validate only
the stable request structure and leave model validation to the Gateway.

```ts
import { createNodeYirClient } from '@yir-ai/sdk/server';
import { findModelContract, validateModelParameters } from '@yir-ai/sdk/frontend';

const client = createNodeYirClient(); // Server only: YIR_API_KEY
const catalog = await client.getModelContracts();
const detail = await client.getModelContract('openai/gpt-image-2');
const model = findModelContract(catalog, detail.model.id);
validateModelParameters(model!.id, 'generate_image', 'text', { n: 1 }, catalog);
```

`getModelContracts()` reads `/v1/models?include=parameters`; model detail reads
`/v1/models/{creator}/{model}?view=contract`. Unknown schema versions or rule
semantics fail explicitly. Applications own cache refresh; a cached contract
does not establish live availability, price or authorization.

Generate a customer-owned snapshot during development, with the API key supplied
only in the process environment:

```sh
pnpm exec yir-models --output src/models.ts
```

The generated file contains parameter metadata and a catalog version, without
credentials or prices. Import it with the pure `@yir-ai/sdk/frontend` helpers.
This entry has no network client, UI framework, bundled model registry or pricing
engine. Refresh the snapshot when updating the customer's supported models;
review the data change independently of the SDK version.

Use the customer's backend for `quoteImage`, `quoteVideo`, or `quoteBatch` with
1–20 explicit requests. These methods read current server prices. An output-only
estimate excludes input charges and is not a spending limit. A quote does not
guarantee a price. Budget approval, customer retail prices and durable request
storage belong to the customer application.

## Migration from 0.1.0

- Local parameter validation requires an explicit catalog. Pass it to
  `createYirClient(transport, catalog)` or `createNodeYirClient({ modelContracts: catalog })`
  when local model checks are wanted. The Gateway remains authoritative.
- `validateModelParameters` takes the catalog as its fifth argument;
  `validateGeneration` and the image builders accept it as their final argument.
- Remove `getModelPrices`, `/pricing`, `calculatePrice`, `buildPriceInput` and
  price-table imports. No exhaustive specification-price table is exposed.
- Legacy `/model-contracts` getters remain explicit historical snapshots; they
  do not gate runtime clients and are not the recommended UI data source.
- Job status validation, idempotency, polling, cancellation and result warnings
  remain unchanged. No SDK package or version tag has been published by this change.

## 中文摘要

SDK 维护协议，API 提供模型参数合同。客户在开发阶段生成自己的 `models.ts`，
前端用纯函数查询和校验，界面无需等待网络；更新模型目录无需更新 SDK。
缓存仅是参数参考，当前可用性、报价、路由和计费由 Gateway 决定。
报价经客户后端调用，批量报价最多 20 个明确请求，不展开参数笛卡儿积。
旧全规格价格表及客户端计价入口已移除；零售定价和授权由客户自行负责。
