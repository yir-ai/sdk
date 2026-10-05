# Yir TypeScript SDK

> 内测阶段（0.x）。不兼容变更只随 minor 版本发布，迁移说明写在 README 与[变更记录](CHANGELOG.md)中。比 SDK 新的字段和取值按数据读取，新增模型与选项无需升级 SDK。

[English](../../README.md) | 简体中文 · [仓库总览](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/README.md) · [示例](examples.md)

单个 `@yir-ai/sdk` 包支持图像和视频生成。使用具备原生 `fetch`、Web Crypto 和 `Blob` 的 Node 环境（可从 Node 22+ 起步）；开发使用 pnpm 10.30.1。

## 安装

从 npm 安装：

```sh
pnpm add @yir-ai/sdk@0.10.0
```

本地开发时，可在本仓库检出目录构建归档：

```sh
cd typescript
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination ./.tmp/scratch
```

随后在应用目录安装归档（替换绝对路径）：

```sh
pnpm add /absolute/path/to/sdk/typescript/.tmp/scratch/yir-ai-sdk-0.10.0.tgz
```

不要将仓库根目录作为 Node 包安装。此包使用 ESM。

## 入口

| 导入路径 | 用途 |
| --- | --- |
| `@yir-ai/sdk/server` | `createNodeYirClient`、自定义传输客户端、任务、文件和 Webhook 验签 |
| `@yir-ai/sdk/frontend` | 外部模型合同查询和参数校验，无网络、密钥或计价逻辑 |
| `@yir-ai/sdk/browser` | 目录查询、参数校验与请求构造，无网络与密钥 |
| `@yir-ai/sdk/shared` | 共享类型和纯逻辑 |
| `@yir-ai/sdk/vercel` | 服务端 Vercel AI SDK 7 / Provider V4 适配 |

server 与 browser 依赖 shared，shared 不反向依赖。根入口保留服务端兼容性；包内不带模型目录，`model-contracts` 与 `pricing` 入口已移除。新代码优先使用 server/frontend，参数快照由客户生成。不得将 Yir Key 传给浏览器；密钥客户端拒绝浏览器运行且不提供绕过开关。浏览器应调用应用自己的已认证后端。

```ts
import { createNodeYirClient } from '@yir-ai/sdk/server';
import type { Job } from '@yir-ai/sdk/shared';

// 读取 YIR_API_KEY；可用 YIR_BASE_URL 覆盖默认网关。
const client = createNodeYirClient();
```

也可传入 `{ apiKey, baseURL, fetch, headers, userAgent, timeoutMs }`。默认地址为 `https://gateway.yir.ai`。`timeoutMs` 限制每个 Gateway 请求（包括读取响应体）的时长，默认为 `DEFAULT_REQUEST_TIMEOUT_MS`（30 秒，与 Go SDK 一致）；设为 `0` 或 `Infinity` 时不限制，超时以 `TimeoutError` 拒绝。提交超时或结果未知时，须用同一请求和幂等键恢复。`createYirClient(transport)` 保留显式传输合同：注入的传输负责认证、HTTP 序列化、响应解码和错误处理，不是浏览器密钥客户端。要支持 `getFileContentURL`，自定义传输须遵守 `redirect: "manual"`：遇到 3xx 时不跟随，返回 `{ status, location }`；否则该调用会安全失败。

## 报价、授权、持久化、提交

可直接调用 `client.submitImage(request)` 或 `client.submitVideo(request)`，SDK 每次调用自动生成随机幂等键。显式键去除首尾空白，必须非空且不含换行。Submit 不隐式重试；再次调用或跨进程恢复时，通过第二个参数传入已保存的键并复用完整请求。服务端同一 Job 内的故障转移不依赖客户端传键。

[quickstart.mjs](../../examples/quickstart.mjs) 的 `prepareImage(client, input, maxCost)` 构造请求并报价。它要求供给可用且主价格有估价，返回该估价和带上已批准 `max_cost` 的请求。

计费：不冻结余额。上游实际计费的每个 Attempt 都按上游权威金额乘托管折扣收取，包括失败的 Attempt 和其后发生回退的 Attempt；上游未计费的 Attempt，以及 Yir 自身的交付失败和结果超时，不收费。`max_cost` 封顶整个 Job 的总费用，并跳过估价超过它的路线。报价的主价格是估价，不是上限。显式 `billing_mode: "actual"`（仅支持 KIE/APIMart Kling 2.6/3.0 Motion Control 与 FAL FLUX 2 Pro 图片编辑）要求 `routing.only`，不能同时设置 `max_cost`，且没有上限；余额不足的部分形成欠款，由后续手动充值偿还，欠款未清阻止新 Job。应用须将客户授权与完整请求、幂等键一起持久化。

应用必须先审批预算并持久化 `{ request, idempotencyKey }`，再调用 `submitSavedImage(client, saved)`。保存所有字段，包括参数、引用、路由、预算及 Webhook URL。每个预期操作只生成一次键，重试时不能生成新键。辅助函数不实现数据库、客户余额检查或审批。

视频使用 `quoteVideo(request)` 和 `submitVideo(savedRequest, savedKey)`，遵循同样流程。报价不会提交任务，接受新工作前应检查报价是否过期。提交结果未知时，不得用新报价或新预算替换已保存请求，应先恢复原操作。


## 任务和恢复

保存返回的 `job.id`。`getJob(id)` 查询完整任务详情，`getJobStatus(id)` 查询轻量状态摘要 `JobStatusResponse`。使用 `waitForJob(id, options)`（Node 客户端）或 `waitForJob(client, id, options)`（自定义传输客户端）。状态查询默认长轮询：`getJobStatus(id, { waitSeconds })` 让 Gateway 挂起查询直到状态变化（最长 30 秒），`waitForJob` 使用 `statusWaitSeconds`（默认 20，自动收进超时之内；设为 0 关闭），无需 Webhook，Yir 记录终态后约 1 秒即可拿到。Gateway 未挂起直接返回时，回退到 `pollDelayMs` 退避（前 30 秒每 5 秒，约 90 秒内每 10 秒，之后每 20 秒；设置 `pollIntervalMs` 可改为固定间隔）。默认 5 分钟超时，进入终态后只读取一次完整 `Job`，若终态摘要与详情状态不符抛出 `job_state_inconsistent` 错误。`YirTimeoutError` 保留任务 ID 与 `lastStatus`；超时和 abort 只停止本地等待，不取消任务或代表退款。用保存的 ID 恢复；提交未返回 ID 时，重交完全相同的请求与键。

`YirJobError` 包含失败或取消的终态任务。`YirAPIError` 在可用时提供 status、code、retryable、action 和 requestId。错误响应体没有错误码时，code 为 `http_error`（与 Go SDK 一致；旧版本为 `HTTP_<status>`），HTTP 状态见 `status`。`action` 可能出现比 SDK 更新的取值（`YirErrorAction`）。`submitImage` 与 `submitVideo` 收到的响应不是 ID 和状态都有效的 Job 时，以 `response_invalid` 拒绝。应用逻辑应依赖稳定错误码，`YIR_ERROR_CODES` 与 `YirErrorCode` 类型列出全部稳定错误码。`cancelJob(id, options)` 显式申请取消，需检查 cancellation 和终态账单，不能假定立即取消或零费用。每个任务的 `billing.total_charged_by_yir` 只结算一次。结果 URL 会过期，应检查 `result.availability` 并及时复制到自己的资源库。

## 模型详情

`getModel("creator/model")` 读取 Market `ModelDetail`：`specifications` 及各渠道展示价格 `channels`（未公布价格时没有 `amount_micros`），以及可选的 `channel_parameters`。须传规范 ID，别名不能作为资源路径；非法 ID 在本地以 `model_request_invalid` 失败。未知字段会保留，但 ID 不一致或必填值非法时以 `model_response_invalid` 失败。模型不存在时以 `YirAPIError` 404 `YIR_MODEL_NOT_FOUND` 拒绝。Market 价格仅供展示，提交前仍需报价。`getModelContract` 仍用于读取带版本的参数合同（`view=contract`）。另导出 `modelDetailPath` 与 `parseModelDetail`，供自定义传输使用。

传入目录创建的客户端（`createYirClient(transport, catalog)` 或 `modelContracts`），只对该目录描述的模型、操作和输入方式校验参数与引用。其余请求（例如目录读取之后才上线的模型）只做协议检查，交由 Gateway 判断；需要对新模型做本地检查时，用 `getModelContracts` 刷新目录。Vercel 适配器行为相同。`validateGeneration(operation, request, catalog)` 和请求构造器仍然严格，目录外的模型抛出 `model_contract_unavailable`；要把请求限定在该目录内，请自行调用它们。

## 文件与 Webhook

媒体引用二选一：`file_id`（ready 的文件）或 `url`（公开 HTTPS 地址，Yir 在提交时导入，最大 100 MiB，拒绝 data URL）。更大或不可公开访问的媒体使用文件上传。`completeFile` 可能返回 `processing`，`uploadFile` 默认最多等待五分钟到 `ready`，也可用 `waitForFileReady` 继续等待已保存的文件 ID。等待超时不会取消服务端分析。AI SDK 适配器支持上传内联字节；URL 输入需由应用先下载为字节。

`createFiles(request, key)` 创建上传计划；`uploadFile(client, plan, blob)` 上传并完成计划；`createAndUploadFile(client, metadata, blob, key)` 合并这些步骤。使用稳定上传键并保留文件 ID；`getFile(id)` 查询状态，`completeFile(id)` 完成手动上传。生成请求仅引用 ready 文件，使用 `file_id` 和相应 role。上传辅助函数支持服务端的单段及分段计划。

`getFileContentURL(id)` 返回 ready 文件的短时签名 URL。Node 传输以 `redirect: "manual"` 从 307 响应的 `Location` 头读取该 URL，从不跟随跳转，因此 API Key 不会发给存储端。请求该 URL 时不要带 Gateway 凭据；过期后重新获取。只接受绝对 `https` URL，其余情况以 `file_content_response_invalid` 拒绝，错误中不含该 URL。文件不存在以 `YirAPIError` 404 `YIR_FILE_NOT_FOUND` 拒绝；尚未 ready 返回 409 `YIR_FILE_NOT_READY`（用 `waitForFileReady` 等待后重试）；已过期返回 410 `YIR_FILE_EXPIRED`（需重新上传）。

提交请求可设置 `webhook_url`。用账户 Webhook secret（不是 API Key）调用 `verifyWebhookSignature({ secret, id, timestamp, signature, rawBody })`。传入 JSON 解析前的原始字节，将回调签名元数据映射到 `id`、`timestamp` 和 `signature`。默认时钟容差为 300 秒。拒绝无效结果，按 Webhook ID 持久化去重；即使轮询也观察到终态，仍只结算一次。`constructWebhookEvent` 校验同样的字段，返回 `{ id, timestamp, job }`，失败时抛出带稳定 `reason` 的 `YirWebhookVerificationError`。`reason` 为 `unsupported_event` 表示签名有效，但请求体不是本 SDK 能识别的终态 Job（例如比 SDK 更新的事件类型）：返回 2xx 确认收到，记录日志，并按其 `id` 去重。其他原因返回 4xx。持久化工作流可把 Webhook 当作唤醒信号，再用 `getJob` 回读，并保留 `pollDelayMs` 轮询兜底。

## Vercel AI SDK

在应用中运行 `pnpm add ai@7.0.97` 安装适配器已测试的 AI SDK 版本。由 `@yir-ai/sdk/vercel` 导入 `createYirAIProvider`，选择 `provider.imageModel(modelId)` 或 `provider.videoModel(modelId)`。适配目标是 AI SDK 7 / Provider V4，不是旧接口。

`providerOptions.yir.idempotencyKey` 可选，省略时每次调用生成一个键。需要恢复时传入已保存的键，以及 `maxCost`、`parameters` 和可选 `routing`。调用前完成报价和审批；适配器不报价、不审批预算、不持久化请求。图像路径提交、等待并下载结果；视频路径启动任务，返回含 `jobId` 和 `modelId` 的可序列化 operation 用于状态恢复，应保存它。内联引用文件的上传键由同次生成键派生，恢复时须保留相同字节。

不支持图像 mask、像素 `size` 和视频像素 resolution，分辨率使用 Yir parameters。`seed` 与视频 `fps` 仅在客户端目录为该模型声明时映射为同名 Yir 参数，否则丢弃并返回 `unsupported` 警告。通用参数与 Yir 参数冲突会被拒绝。可执行调用和映射见 [Vercel 测试](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs)。

## 升级到 0.10.0

0.10.0 为 minor 版本，含不兼容变更，为 1.0 合同做准备：

- 移除内置模型目录：`listModelContracts`、`getModelContract`、`getModelOperationContract`、`KnownModelID` 与 `@yir-ai/sdk/model-contracts` 入口已删除。用 `client.getModelContracts()` 获取目录（或据此生成 `models.ts`），再用 `findModelContract`、`findModelOperationContract` 与 `validateGeneration(operation, request, catalog)`。新增模型和参数调整都不需要发布 SDK。
- Job ID 是不透明字符串。任何非空、不超过 64 个字符、可安全作为一段 URL 路径的 ID 都会被接受（`isValidJobID`）；按字符串保存，不要解析。
- 未配置目录时，报价可能把你传入的别名回显为规范模型 ID，SDK 只检查模型字段存在；配置目录时仍按解析后的 ID 比对。Vercel 视频适配器不再要求 `job.model` 等于创建时使用的别名。
- `YirPublicError.details`（`YirErrorDetail[]`）定位 `YIR_INVALID_REQUEST` 的无效字段：`field`、稳定的 `reason`（如 `unsupported`、`required`）以及合同允许值 `allowed`。
- `StandardMediaSource` 与 `StandardReference` 除 `file_id` 外也接受 `url`，与 API 一致；`buildImageGenerationRequest` 接受 `image: { url }`。
- Vercel 适配器仅在客户端目录为该模型声明了 `seed`、视频 `fps` 时才映射它们；否则按 AI SDK 惯例丢弃并返回 `unsupported` 警告，不再让请求在 Gateway 失败。
- 与本 SDK 同批发布的 Gateway 变化：`parameters` 必填；不再接受顶层 `resolution`、`aspect_ratio`、`n`、`duration`、`generate_audio`、`input.image`，以及大小写不同的 `input.type` 或参考角色；`resolution` 与 `aspect_ratio` 必须是模型合同中的取值（不区分大小写），`1024`、`2048x2048`、`16x9` 等写法会被拒绝。模型别名精简为短名、厂商模型 ID，以及存在时的 Vercel AI Gateway ID；建议使用 `bytedance/seedance-2.0` 这类规范 ID。

更早的版本说明见[变更记录](CHANGELOG.md)。

## 验证和维护

在 `typescript/` 执行 `pnpm check`，验证生成合同、测试、类型、浏览器边界及实际归档安装。公开快照使用 `pnpm generate:model-contracts` 和 `pnpm check:model-contracts`。Node 产物保留在本子目录。[MIT 许可证](../../LICENSE)。
