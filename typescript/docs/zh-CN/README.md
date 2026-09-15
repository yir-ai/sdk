# Yir TypeScript SDK

[English](../../README.md) | 简体中文 · [仓库总览](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/README.md) · [示例](examples.md)

单个 `@yir-ai/sdk` 包支持图像和视频生成。使用具备原生 `fetch`、Web Crypto 和 `Blob` 的 Node 环境（可从 Node 22+ 起步）；开发使用 pnpm 10.30.1。

## 安装

从 npm 安装：

```sh
pnpm add @yir-ai/sdk@0.1.0
```

如需构建本地归档，在本仓库检出目录执行：

```sh
cd typescript
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination ./artifacts
```

随后在应用目录安装归档（替换绝对路径）：

```sh
pnpm add /absolute/path/to/sdk/typescript/artifacts/yir-ai-sdk-0.1.0.tgz
```

不要将仓库根目录作为 Node 包安装。此包使用 ESM。

## 入口

| 导入路径 | 用途 |
| --- | --- |
| `@yir-ai/sdk/server` | `createNodeYirClient`、自定义传输客户端、任务、文件和 Webhook 验签 |
| `@yir-ai/sdk/browser` | 模型合同、参数校验、请求构造和纯价格计算，无网络与密钥 |
| `@yir-ai/sdk/shared` | 共享类型和纯逻辑 |
| `@yir-ai/sdk/vercel` | 服务端 Vercel AI SDK 7 / Provider V4 适配 |

server 与 browser 依赖 shared，shared 不反向依赖。根入口保留服务端兼容性，`pricing` 和 `model-contracts` 子入口继续可用。新代码优先明确使用 server/browser 入口。不得将 Yir Key 传给浏览器；密钥客户端拒绝浏览器运行且不提供绕过开关。浏览器应调用应用自己的已认证后端。

```ts
import { createNodeYirClient } from '@yir-ai/sdk/server';
import { calculatePrice, getModelContract } from '@yir-ai/sdk/browser';
import type { Job } from '@yir-ai/sdk/shared';

// 读取 YIR_API_KEY；可用 YIR_BASE_URL 覆盖默认网关。
const client = createNodeYirClient();
```

也可传入 `{ apiKey, baseURL, fetch, headers, userAgent }`。默认地址为 `https://gateway.yir.ai`。`createYirClient(transport)` 保留显式传输合同：注入的传输负责认证、HTTP 序列化、响应解码和错误处理，不是浏览器密钥客户端。

## 报价、授权、持久化、提交

[quickstart.mjs](../../examples/quickstart.mjs) 的 `prepareImage(client, input)` 构造请求并报价。它要求供给可用、主价格为固定价格且具备可验证上限，返回包含 `max_cost` 的请求。这是示例采用的保守策略，不改变 API 支持的报价类型。

应用必须先审批预算并持久化 `{ request, idempotencyKey }`，再调用 `submitSavedImage(client, saved)`。保存所有字段，包括参数、引用、路由、预算及 Webhook URL。每个预期操作只生成一次键，重试时不能生成新键。辅助函数不实现数据库、客户余额检查或审批。

视频使用 `quoteVideo(request)` 和 `submitVideo(savedRequest, savedKey)`，遵循同样流程。报价不会提交任务，接受新工作前应检查报价是否过期。提交结果未知时，不得用新报价或新预算替换已保存请求，应先恢复原操作。

金额使用十进制字符串。本地预览、仅输出部分的估算或冻结预算均非最终账单。`getModelPrices(model, operation, inputMode, options)` 加载并校验价格；缓存应区分账户、策略、模型、操作、输入模式和过滤条件，并遵守过期时间。浏览器 `calculatePrice` 只计算传入表，不发请求。客户零售价与 Yir 成本分离；缺行不表示免费或不支持该模型。

## 任务和恢复

保存返回的 `job.id`。使用 `getJob(id)`、Node 客户端的 `waitForJob(id, options)`，或自定义传输客户端的 `waitForJob(client, id, options)`。默认每 2 秒轮询，5 分钟超时。`YirTimeoutError` 保留任务 ID；超时和 abort 只停止本地等待，不取消任务或代表退款。用保存的 ID 恢复；提交未返回 ID 时，重交完全相同的请求与键。

`YirJobError` 包含失败或取消的终态任务。`YirAPIError` 在可用时提供 status、code、retryable、action 和 requestId。应用逻辑应依赖稳定错误码。`cancelJob(id)` 显式申请取消，需检查 cancellation 和终态账单，不能假定立即取消或零费用。每个任务的 `billing.total_charged_by_yir` 只结算一次。结果 URL 会过期，应检查 `result.availability` 并及时复制到自己的资源库。

## 文件与 Webhook

`createFiles(request, key)` 创建上传计划；`uploadFile(client, plan, blob)` 上传并完成计划；`createAndUploadFile(client, metadata, blob, key)` 合并这些步骤。使用稳定上传键并保留文件 ID；`getFile(id)` 查询状态，`completeFile(id)` 完成手动上传。生成请求仅引用 ready 文件，使用 `file_id` 和相应 role。上传辅助函数支持服务端的单段及分段计划。

提交请求可设置 `webhook_url`。用账户 Webhook secret（不是 API Key）调用 `verifyWebhookSignature({ secret, id, timestamp, signature, rawBody })`。传入 JSON 解析前的原始字节，将回调签名元数据映射到 `id`、`timestamp` 和 `signature`。默认时钟容差为 300 秒。拒绝无效结果，按 Webhook ID 持久化去重；即使轮询也观察到终态，仍只结算一次。

## Vercel AI SDK

在应用中运行 `pnpm add ai@7.0.97` 安装适配器已测试的 AI SDK 版本。由 `@yir-ai/sdk/vercel` 导入 `createYirAIProvider`，选择 `provider.imageModel(modelId)` 或 `provider.videoModel(modelId)`。适配目标是 AI SDK 7 / Provider V4，不是旧接口。

每次生成必须传入 `providerOptions.yir.idempotencyKey`，并在此传入已保存的 `maxCost`、`parameters` 和可选 `routing`。调用前完成报价和审批；适配器不报价、不审批预算、不持久化请求。图像路径提交、等待并下载结果；视频路径启动任务，返回含 `jobId` 和 `modelId` 的可序列化 operation 用于状态恢复，应保存它。内联引用文件的上传键由已保存生成键派生，恢复时须保留相同字节。

不支持图像 mask、像素 `size`、seed、视频像素 resolution 和 fps；分辨率使用 Yir parameters。通用参数与 Yir 参数冲突会被拒绝。可执行调用和映射见 [Vercel 测试](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs)。

## 合同更新（尚未发布）

H3 reference 合同允许 1–15 项引用：图片最多 9 项、视频和音频各最多 3 项，可仅使用音频，保留 URL 与顺序。图生视频仍仅允许 adaptive。当前渠道仍仅开放原有 1–5 张图片；视频、音频或第 6 张图片不代表已有授权供应、有效计价或可信媒体时长。

任务结果可包含 `result.warnings: ["additional_results_unavailable"]`，表示主要结果已交付，但可选附加结果未能交付。任务仍为 `succeeded`，`files` 仅含成功交付的文件；正常或历史响应可省略警告，结果过期后仍可保留历史警告。这不是生成失败，不授权自动重生成，不改变费用或 `parameter_notices`。

Seedance 2.0 支持可选布尔参数 `return_last_frame`（默认 false），其他模型拒绝该参数。请求尾帧需要覆盖完整费用的有效报价，不得套用普通视频价格；真实尾帧交付仍待验证。

Seedream 5.0 的文本和图片合同现接受 `4K`，图片输入最多允许 14 张参考图，其他参数不变。此合同更新不代表 4K 已在线可用，也不确认价格或精确输出尺寸；这些仍需服务端集成与报价确认。

当前工作版本为 Nano Banana 2 的文本和图片输入增加可选的 `parameters.web_search`、`parameters.image_search`，默认均为 false；`image_search: true` 要求 `web_search: true`。Nano Banana Pro 的文本和图片输入仅接受可选布尔值 `web_search`（默认 false），拒绝 `image_search`，包括显式 false；其余模型拒绝这两个字段。供应商搜索执行仍待实证，本次元数据更新不改变价格或开放供应。校验保留调用者的参数。搜索需要明确支持该能力的供应和有效报价，静态支持不代表当前可用或免费。本更新尚未包含在已发布的 `0.1.0` 包中。

引用校验同时执行随包合同中的角色数量、必选角色组合、输出时长限制，并拒绝重复引用。报价、保存授权与提交之间应保留完整请求。

## 验证和维护

在 `typescript/` 执行 `pnpm check`，验证生成合同、测试、类型、浏览器边界及实际归档安装。公开快照使用 `pnpm generate:model-contracts` 和 `pnpm check:model-contracts`。Node 产物保留在本子目录。[MIT 许可证](../../LICENSE)。
