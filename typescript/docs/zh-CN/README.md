# Yir TypeScript SDK

> 0.2.0 protocol / 协议升级：模型参数来自 API，SDK 不再以内置模型清单限制请求；旧全量价格表与客户端计价已移除。升级前阅读 [migration guide](https://github.com/yir-ai/sdk/blob/main/typescript/docs/parameter-contracts.md)。

[English](../../README.md) | 简体中文 · [仓库总览](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/README.md) · [示例](examples.md)

单个 `@yir-ai/sdk` 包支持图像和视频生成。使用具备原生 `fetch`、Web Crypto 和 `Blob` 的 Node 环境（可从 Node 22+ 起步）；开发使用 pnpm 10.30.1。

## 安装

从 npm 安装：

```sh
pnpm add @yir-ai/sdk@0.2.0
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
pnpm add /absolute/path/to/sdk/typescript/artifacts/yir-ai-sdk-0.2.0.tgz
```

不要将仓库根目录作为 Node 包安装。此包使用 ESM。

## 入口

| 导入路径 | 用途 |
| --- | --- |
| `@yir-ai/sdk/server` | `createNodeYirClient`、自定义传输客户端、任务、文件和 Webhook 验签 |
| `@yir-ai/sdk/frontend` | 外部模型合同查询和参数校验，无网络、密钥或计价逻辑 |
| `@yir-ai/sdk/browser` | 既有合同与请求构造兼容入口，无网络与密钥 |
| `@yir-ai/sdk/shared` | 共享类型和纯逻辑 |
| `@yir-ai/sdk/vercel` | 服务端 Vercel AI SDK 7 / Provider V4 适配 |

server 与 browser 依赖 shared，shared 不反向依赖。根入口保留服务端兼容性；`model-contracts` 为历史静态合同入口，`pricing` 已移除。新代码优先使用 server/frontend，参数快照由客户生成。不得将 Yir Key 传给浏览器；密钥客户端拒绝浏览器运行且不提供绕过开关。浏览器应调用应用自己的已认证后端。

```ts
import { createNodeYirClient } from '@yir-ai/sdk/server';
import type { Job } from '@yir-ai/sdk/shared';

// 读取 YIR_API_KEY；可用 YIR_BASE_URL 覆盖默认网关。
const client = createNodeYirClient();
```

也可传入 `{ apiKey, baseURL, fetch, headers, userAgent }`。默认地址为 `https://gateway.yir.ai`。`createYirClient(transport)` 保留显式传输合同：注入的传输负责认证、HTTP 序列化、响应解码和错误处理，不是浏览器密钥客户端。

## 报价、授权、持久化、提交

[quickstart.mjs](../../examples/quickstart.mjs) 的 `prepareImage(client, input)` 构造请求并报价。它要求供给可用、主价格为固定价格且具备可验证上限，返回包含 `max_cost` 的请求。这是示例采用的保守策略，不改变 API 支持的报价类型。

应用必须先审批预算并持久化 `{ request, idempotencyKey }`，再调用 `submitSavedImage(client, saved)`。保存所有字段，包括参数、引用、路由、预算及 Webhook URL。每个预期操作只生成一次键，重试时不能生成新键。辅助函数不实现数据库、客户余额检查或审批。

视频使用 `quoteVideo(request)` 和 `submitVideo(savedRequest, savedKey)`，遵循同样流程。报价不会提交任务，接受新工作前应检查报价是否过期。提交结果未知时，不得用新报价或新预算替换已保存请求，应先恢复原操作。


## 任务和恢复

保存返回的 `job.id`。`getJob(id)` 查询完整任务详情，`getJobStatus(id)` 查询轻量状态摘要 `JobStatusResponse`。使用 `waitForJob(id, options)`（Node 客户端）或 `waitForJob(client, id, options)`（自定义传输客户端）。默认每 2 秒轮询状态摘要，5 分钟超时，进入终态后只读取一次完整 `Job`，若终态摘要与详情状态不符抛出 `job_state_inconsistent` 错误。`YirTimeoutError` 保留任务 ID 与 `lastStatus`；超时和 abort 只停止本地等待，不取消任务或代表退款。用保存的 ID 恢复；提交未返回 ID 时，重交完全相同的请求与键。

`YirJobError` 包含失败或取消的终态任务。`YirAPIError` 在可用时提供 status、code、retryable、action 和 requestId。应用逻辑应依赖稳定错误码。`cancelJob(id)` 显式申请取消，需检查 cancellation 和终态账单，不能假定立即取消或零费用。每个任务的 `billing.total_charged_by_yir` 只结算一次。结果 URL 会过期，应检查 `result.availability` 并及时复制到自己的资源库。

## 文件与 Webhook

`createFiles(request, key)` 创建上传计划；`uploadFile(client, plan, blob)` 上传并完成计划；`createAndUploadFile(client, metadata, blob, key)` 合并这些步骤。使用稳定上传键并保留文件 ID；`getFile(id)` 查询状态，`completeFile(id)` 完成手动上传。生成请求仅引用 ready 文件，使用 `file_id` 和相应 role。上传辅助函数支持服务端的单段及分段计划。

提交请求可设置 `webhook_url`。用账户 Webhook secret（不是 API Key）调用 `verifyWebhookSignature({ secret, id, timestamp, signature, rawBody })`。传入 JSON 解析前的原始字节，将回调签名元数据映射到 `id`、`timestamp` 和 `signature`。默认时钟容差为 300 秒。拒绝无效结果，按 Webhook ID 持久化去重；即使轮询也观察到终态，仍只结算一次。

## Vercel AI SDK

在应用中运行 `pnpm add ai@7.0.97` 安装适配器已测试的 AI SDK 版本。由 `@yir-ai/sdk/vercel` 导入 `createYirAIProvider`，选择 `provider.imageModel(modelId)` 或 `provider.videoModel(modelId)`。适配目标是 AI SDK 7 / Provider V4，不是旧接口。

每次生成必须传入 `providerOptions.yir.idempotencyKey`，并在此传入已保存的 `maxCost`、`parameters` 和可选 `routing`。调用前完成报价和审批；适配器不报价、不审批预算、不持久化请求。图像路径提交、等待并下载结果；视频路径启动任务，返回含 `jobId` 和 `modelId` 的可序列化 operation 用于状态恢复，应保存它。内联引用文件的上传键由已保存生成键派生，恢复时须保留相同字节。

不支持图像 mask、像素 `size`、seed、视频像素 resolution 和 fps；分辨率使用 Yir parameters。通用参数与 Yir 参数冲突会被拒绝。可执行调用和映射见 [Vercel 测试](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs)。

## 0.2.0 合同更新

H3 reference 合同允许 1–15 项引用：图片最多 9 项、视频和音频各最多 3 项，可仅使用音频，保留 URL 与顺序。图生视频仍仅允许 adaptive。2026-09-16 已验证的 KIE 集成支持上述数量范围内的混合引用，但至少需要一项图片或视频；纯音频虽符合公共合同，仍不被该供应接受。每段视频或音频须为 2–15 秒，视频和音频各自总时长最多 15 秒。音视频须使用属于调用者、已完成可信测量且 ready 的 Files，以 `file_id` 引用；图片 URL 继续兼容。报价和准入使用可信测量，提交校验绑定的测量快照。其他渠道仍遵循各自支持的子集。完整请求必须取得有效报价；SDK 静态校验不代表在线可用或实际生成成功。此前 1–5 张图片的限制属于历史供应快照，不是当前 KIE 集成边界。

任务结果可包含 `result.warnings: ["additional_results_unavailable"]`，表示主要结果已交付，但可选附加结果未能交付。任务仍为 `succeeded`，`files` 仅含成功交付的文件；正常或历史响应可省略警告，结果过期后仍可保留历史警告。这不是生成失败，不授权自动重生成，不改变费用或 `parameter_notices`。

Seedance 2.0 支持可选布尔参数 `return_last_frame`（默认 false），其他模型拒绝该参数。请求尾帧需要覆盖完整费用的有效报价，不得套用普通视频价格；真实尾帧交付仍待验证。

Seedream 5.0 的文本和图片合同现接受 `4K`，图片输入最多允许 14 张参考图，其他参数不变。此合同更新不代表 4K 已在线可用，也不确认价格或精确输出尺寸；这些仍需服务端集成与报价确认。

当前工作版本为 Nano Banana 2 的文本和图片输入增加可选的 `parameters.web_search`、`parameters.image_search`，默认均为 false；`image_search: true` 要求 `web_search: true`。Nano Banana Pro 的文本和图片输入仅接受可选布尔值 `web_search`（默认 false），拒绝 `image_search`，包括显式 false；其余模型拒绝这两个字段。供应商搜索执行仍待实证，本次元数据更新不改变价格或开放供应。校验保留调用者的参数。搜索需要明确支持该能力的供应和有效报价，静态支持不代表当前可用或免费。本更新尚未包含在已发布的 `0.1.0` 包中。

当前开发分支新增 `getJobStatus`（`GET /v1/jobs/{id}/status`），并将 `waitForJob` 改造为两阶段轮询：先轮询轻量状态摘要 `JobStatusResponse`，进入终态（`succeeded`、`failed`、`cancelled`）后再读取一次完整 `Job`；终态状态不一致时抛出 `job_state_inconsistent` 错误。`WaitForJobOptions.onPoll` 接收类型由完整 `Job` 改为 `JobStatusResponse` 摘要，`YirTimeoutError.lastJob` 迁移为 `lastStatus`。等待异常（包括 abort、超时与传输异常）不伪造残缺任务。查询 status 遇到 404 错误时不静默回退到详情接口。已交付结果保留可选 `result.warnings`。上述状态轮询及错误结构属于新契约，未包含在已发布的 `0.1.0` 中；这些不兼容变化进入 0.2.0，升级时请按迁移说明调整调用方。

显式提供参数合同时，引用校验执行其中的角色数量、必选角色组合和输出时长限制，并拒绝重复引用。模型专属语义依赖由网关校验。报价、保存授权与提交之间应保留完整请求。

## 验证和维护

在 `typescript/` 执行 `pnpm check`，验证生成合同、测试、类型、浏览器边界及实际归档安装。公开快照使用 `pnpm generate:model-contracts` 和 `pnpm check:model-contracts`。Node 产物保留在本子目录。[MIT 许可证](../../LICENSE)。
