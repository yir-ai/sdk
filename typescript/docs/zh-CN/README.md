# Yir TypeScript SDK

> 内测阶段（0.x）。不兼容变更只随 minor 版本发布，迁移说明写在 README 与[变更记录](CHANGELOG.md)中。比 SDK 新的字段和取值按数据读取，新增模型与选项无需升级 SDK。

[English](../../README.md) | 简体中文 · [仓库总览](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/README.md) · [示例](examples.md)

单个 `@yir-ai/sdk` 包支持图像和视频生成。使用具备原生 `fetch`、Web Crypto 和 `Blob` 的 Node 环境（可从 Node 22+ 起步）；开发使用 pnpm 10.30.1。Cloudflare Workers 可从 `/server` 导入同一客户端，显式传入 `apiKey`；`createNodeYirClient` 名称保留兼容，无需开启 Node 兼容模式。

`parameters.n` 表示**单次 API 请求（一个 Job）的输出数量**，允许值不代表应用的批量张数。例如，模型只接受 `n=1` 时，应用仍可提交四个独立 Job 生成四张图片。批量数量控件应与模型的 `n` 参数分开维护；每个 Job 分别报价，并拥有独立的幂等键、状态和账单。

## 安装

从 npm 安装：

```sh
pnpm add @yir-ai/sdk
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
pnpm add /absolute/path/to/sdk/typescript/.tmp/scratch/yir-ai-sdk-VERSION.tgz
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

也可传入 `{ apiKey, baseURL, fetch, headers, userAgent, timeoutMs, referralCode }`。默认地址为 `https://gateway.yir.ai`。`timeoutMs` 限制每个 Gateway 请求（包括读取响应体）的时长，默认为 `DEFAULT_REQUEST_TIMEOUT_MS`（30 秒，与 Go SDK 一致）；设为 `0` 或 `Infinity` 时不限制，超时以 `TimeoutError` 拒绝。提交超时或结果未知时，须用同一请求和幂等键恢复。如果你发布的应用由他人用自己或其用户的 Key 部署，`referralCode` 会把你的 Yir 推广码作为 `Yir-Referral` 发送；Yir 为该码开通合作归因后，这些 Job 计入你的邀请返利，否则该请求头被忽略。`createYirClient(transport)` 保留显式传输合同：注入的传输负责认证、HTTP 序列化、响应解码和错误处理，不是浏览器密钥客户端。要支持 `getFileContentURL`，自定义传输须遵守 `redirect: "manual"`：遇到 3xx 时不跟随，返回 `{ status, location }`；否则该调用会安全失败。

## 报价、授权、持久化、提交

可直接调用 `client.submitImage(request)` 或 `client.submitVideo(request)`，SDK 每次调用自动生成随机幂等键。显式键去除首尾空白，必须非空且不含换行。内置 HTTP 传输对网络故障与 HTTP 502/503/504 最多重试 3 次（退避 0.5、1、2 秒），始终复用同一幂等键与编码后的请求体；读取请求采用相同策略。重试共享请求超时并响应取消，遵守不超过 60 秒的 Retry-After，更长则直接返回错误。其他写请求及终态失败任务不会自动重新提交。再次调用或跨进程恢复时，通过第二个参数传入已保存的键并复用完整请求。服务端同一 Job 内的故障转移不依赖客户端传键。

[quickstart.mjs](../../examples/quickstart.mjs) 的 `prepareImage(client, input, maxCost)` 构造请求并报价。它要求供给可用且主价格有估价，返回该估价和带上已批准 `max_cost` 的请求。

计费：不冻结余额。上游实际计费的每个 Attempt 都按上游权威金额乘托管折扣收取，包括失败的 Attempt 和其后发生回退的 Attempt；上游未计费的 Attempt，以及 Yir 自身的交付失败和结果超时，不收费。`max_cost` 封顶整个 Job 的总费用，并跳过估价超过它的路线。报价的主价格是估价，不是上限。报价后价格可能变化：较便宜的渠道可能下线或冷却，路由默认值可能改变可用渠道，目录价格也可能调整。把 `max_cost` 当作在报价之上留有余量的失控兜底，而不是锁价；上限设得等于报价时，可能开始以 `YIR_BUDGET_EXCEEDED` 失败（提交时返回 422 并给出当前最低估价，或出现在 Job 上）。收到该错误时先重新报价，由应用决定是否在新请求中调高上限，不要自动调高。

新请求默认按渠道实际账单结算，无需选择计费模式。缺少可靠估价的渠道仍可能可用，但不能接受 `max_cost`；需要上限时请选择能够估价的渠道。未知价格不等于免费。

应用必须先审批预算并持久化 `{ request, idempotencyKey }`，再调用 `submitSavedImage(client, saved)`。保存所有字段，包括参数、引用、路由、预算及 Webhook URL。每个预期操作只生成一次键，重试时不能生成新键。辅助函数不实现数据库、客户余额检查或审批。

视频使用 `quoteVideo(request)` 和 `submitVideo(savedRequest, savedKey)`，遵循同样流程。报价不会提交任务，接受新工作前应检查报价是否过期。提交结果未知时，不得用新报价或新预算替换已保存请求，应先恢复原操作。

音乐与音效使用 `quoteAudio(request)` 和 `submitAudio(savedRequest, savedKey)`（`/v1/audio` 端点），流程相同；`quoteMusic` / `submitMusic` 是它们的旧名，调用永久保留的旧路径 `/v1/music`，行为相同；也可在 `quoteBatch` 中传 `generate_music` / `generate_sound_effect` 项。文本输入为 `prompt`，模型支持自定义歌词时可加 `lyrics`。Suno 模型还支持上传原曲翻唱（`type: "reference"`）：恰好一段 `reference_audio` 原曲（URL 或 File ID，不超过 8 分钟），`prompt` 写新风格，歌词规则与文本输入相同，价格与基础生成相同；带目录的 `validateGeneration` 对其他音频模型报 `input.type` 的 `input_mode_invalid`。`parameters` 可省略，每个模型只接受其合同声明的参数（`n`、`duration`、`instrumental`、`lyrics_optimizer`）。带人声的音乐须使用模型支持的一种歌词来源：`lyrics`、`lyrics_optimizer: true`（按提示词自动写词，部分模型另收写词费用，以报价为准）或 `instrumental: true`，三者互斥。ElevenLabs 音乐不接受歌词，按 `duration` 计价（30–300 秒固定档位，默认 60）；ElevenLabs 音效（`elevenlabs/sound-effects-v2`）只传描述，不接受歌词，`duration` 为 1–22 秒（默认 5），报价的 operation 为 `generate_sound_effect`。Suno（`suno/suno-v6`，非官方接入，Suno 没有官方 API）每次请求返回两首（`n` 固定为 2）。SDK 在发送前拒绝通用冲突；`validateGeneration(operation, request, catalog)` 还按模型合同检查 `n`、`duration` 与歌词来源，各模型的文本长度上限由 Gateway 校验。每个音频文件的实测时长见 `duration_ms`。音乐报价的参数回显不含 `resolution` 与 `aspect_ratio`，因此 `QuoteParameters.resolution` 与 `aspect_ratio` 在类型上为可选；图片与视频回显仍始终包含二者。

文字转语音模型（`minimax/speech-2.8-hd`，最多 10000 字符；`elevenlabs/eleven-v3`，最多 5000 字符）同样使用 `quoteAudio` / `submitAudio`，或在 `quoteBatch` 中传 `generate_speech` 项：`input.prompt` 即朗读文本，`parameters` 只接受 `n`（1）与 `voice`（模型的预设音色 ID，省略则用模型默认音色，音色不影响价格），不接受歌词、`instrumental`、`lyrics_optimizer` 或 `duration`。报价的 operation 为 `generate_speech`，按提示词字符数计价（空格、标点与音频标签都计入），参数回显为 `n` 与 `voice`；Job 交付一个 MP3，实测时长见 `duration_ms`。

```ts
const request = {
  model: "minimax/music-2.6",
  input: { type: "text", prompt: "A warm acoustic folk ballad", lyrics: "[Verse]\nWalking down a dusty road" },
} as const;
const quote = await client.quoteAudio(request);
const job = await client.submitAudio({ ...request, max_cost: "0.20" }, savedKey);
```

3D 使用 `quote3D(request)` 和 `submit3D(savedRequest, savedKey)`（`/v1/3d` 端点），流程相同；也可在 `quoteBatch` 中传 `generate_3d` 项。输入可以是文本（`prompt`）、一张图片（`type: "image"`，恰好一张 `reference_image`，不接受 prompt）或多视角（`type: "multiview"`，一张 `front_view` 加至少一张 `left_view`、`back_view` 或 `right_view`，每个角色至多一张，不接受 prompt；只限合同列出 multiview 输入方式的模型）。`parameters` 可省略：`texture`（`none`、`standard`、`hd`）、`pbr`（需要带贴图，`texture: "none"` 同时 `pbr: true` 会被拒绝）、`face_limit`、`topology`（`triangle`、`quad`）与 `n`（固定为 1）；每个模型只接受其合同声明的取值，省略即模型默认。`validateGeneration("generate_3d", request, catalog)` 按模型合同检查输入方式、参考图与取值。Job 交付一个 glb 文件（`model/gltf-binary`），实测三角面数见 `faces`；超规格结果（未要求的贴图或 PBR）照常交付，并给出 `parameter_notices`。Demo 模式没有 3D 样例：`submit3D` 不发送请求，直接抛出 `demo_operation_unsupported`。

```ts
const model = {
  model: "tencent/hunyuan-3d-3.1-pro",
  input: { type: "image", references: [{ role: "reference_image", url: "https://example.com/chair.png" }] },
  parameters: { texture: "standard", pbr: false },
} as const;
const quote = await client.quote3D(model);
const job = await client.submit3D({ ...model, max_cost: "0.60" }, savedKey);
```


## 任务和恢复

保存返回的 `job.id`。`getJob(id)` 查询完整任务详情，`getJobStatus(id)` 查询轻量状态摘要 `JobStatusResponse`。使用 `waitForJob(id, options)`（Node 客户端）或 `waitForJob(client, id, options)`（自定义传输客户端）。状态查询默认长轮询：`getJobStatus(id, { waitSeconds })` 让 Gateway 挂起查询直到状态变化（最长 30 秒），`waitForJob` 使用 `statusWaitSeconds`（默认 20，自动收进超时之内；设为 0 关闭），无需 Webhook，Yir 记录终态后约 1 秒即可拿到。Gateway 未挂起直接返回时，回退到 `pollDelayMs` 退避（前 30 秒每 5 秒，约 90 秒内每 10 秒，之后每 20 秒；设置 `pollIntervalMs` 可改为固定间隔）。状态查询遇到 `429 YIR_RATE_LIMITED`（按 API Key 的每分钟请求上限）时按 `Retry-After`（`YirAPIError.retryAfterMs`，缺省 1 秒，最长 1 分钟）等待后继续，连续最多 5 次。默认 5 分钟超时，进入终态后只读取一次完整 `Job`，若终态摘要与详情状态不符抛出 `job_state_inconsistent` 错误。`YirTimeoutError` 保留任务 ID 与 `lastStatus`；超时和 abort 只停止本地等待，不取消任务或代表退款。用保存的 ID 恢复；提交未返回 ID 时，重交完全相同的请求与键。

`YirJobError` 包含失败或取消的终态任务。`YirAPIError` 在可用时提供 status、code、retryable、action 和 requestId。错误响应体没有错误码时，code 为 `http_error`（与 Go SDK 一致；旧版本为 `HTTP_<status>`），HTTP 状态见 `status`。`action` 可能出现比 SDK 更新的取值（`YirErrorAction`）。`submitImage` 与 `submitVideo` 收到的响应不是 ID 和状态都有效的 Job 时，以 `response_invalid` 拒绝。应用逻辑应依赖稳定错误码，`YIR_ERROR_CODES` 与 `YirErrorCode` 类型列出全部稳定错误码。`cancelJob(id, options)` 显式申请取消，需检查 cancellation 和终态账单，不能假定立即取消或零费用。每个任务的 `billing.total_charged_by_yir` 只结算一次。结果 URL 会过期，应检查 `result.availability` 并及时复制到自己的资源库。

## Demo 模式

Demo 模式用于不花钱地测试完整生成流程：`createNodeYirClient({ apiKey, demo: true })` 或 `createYirClient(transport, catalog, { demo: true })`。未传 `demo` 时，两者在有进程环境变量的运行环境中都会按 `YIR_DEMO=1`（`1` 或 `true`）开启；显式 `demo: false` 优先。同一进程内第一个开启 demo 的客户端打印一次警告。`createYirAIProvider` 会把 `demo` 传给它创建的客户端；传入自有 `client` 时，请在该客户端上开启 demo（两者同时传入会抛出 `demo_requires_client_option`）。提交照常做本地校验，再调用对应的报价接口（`/v1/images/quotes` 等，不扣费），参数仍由网关校验，但请求不会真正提交。提交返回一个 ID 以 `demo_` 开头的 demo Job，带报价返回的模型和参数回显。报价、文件、余额和模型接口照常访问网关，因此仍需要 API Key。

Demo Job 不保存状态：ID 里编码了创建时间、类型、画幅、`n`、时长、分辨率和场景，所以 `getJob`、`getJobStatus`（按 `waitSeconds` 挂起到下一次状态变化）和 `waitForJob` 在任何进程或 Workers 实例里得到同样结果，且不发网络请求。所有客户端都在本地解答 `demo_` ID，关闭 demo 模式后也一样；用 `isDemoJobID(id)` 区分。图片排队 2 秒、8 秒后成功，视频 25 秒，音频 12 秒。结果指向 `https://public.yir.ai/demo/v1/` 下带 DEMO 徽标的固定文件，按类型和最接近的画幅（视频再按 5 或 10 秒）选取；`width`、`height`、`duration_ms` 是实际文件的值，请求的值保留在 `parameters` 中。像真实结果一样转存文件。扣费恒为 `"0"`。

`demo: { scenario }` 或提示词中的 `[demo:<scenario>]` 标记（标记优先）决定结果：`ok`（默认）；`slow`，排队 6 分钟（超过 `waitForJob` 默认超时）、8 分钟后成功；`fail`，以 `YIR_EXECUTION_FAILED` 失败且不扣费；`reject`，报价后提交抛出 `YirAPIError` 422 `YIR_INPUT_REJECTED`；`cancel`，以 `cancelled` 结束。对未结束的 demo Job 调用 `cancelJob` 返回 `cancelled`，对已结束的抛出 409 `YIR_JOB_NOT_CANCELLABLE`；由于不保存状态，之后的读取仍按原时间线，请保留 `cancelJob` 返回的 Job。

提交返回报价的完整参数回显；之后按 ID 读取 demo Job 只保留 `n`、`aspect_ratio`、`resolution`、`duration` 四项（ID 装不下其余参数）。Demo 模式不覆盖：提交的幂等重放、余额/消费上限/`max_cost` 准入错误（402 与 422 `YIR_BUDGET_EXCEEDED`）、Webhook 投递、部分或过期结果、fallback 计费。

## 模型详情

`getModel("creator/model")` 读取 Market `ModelDetail`：`specifications` 及各渠道展示价格 `channels`（未公布价格时没有 `amount_micros`），以及可选的 `channel_parameters`。须传规范 ID，别名不能作为资源路径；非法 ID 在本地以 `model_request_invalid` 失败。未知字段会保留，但 ID 不一致或必填值非法时以 `model_response_invalid` 失败。模型不存在时以 `YirAPIError` 404 `YIR_MODEL_NOT_FOUND` 拒绝。Market 价格仅供展示，提交前仍需报价。`getModelContract` 仍用于读取带版本的参数合同（`view=contract`）。另导出 `modelDetailPath` 与 `parseModelDetail`，供自定义传输使用。

提交和报价客户端只做协议检查，由 Gateway 最终校验模型参数，传入目录时也一样。Vercel 适配器行为相同，避免旧目录拒绝新参数。`validateGeneration(operation, request, catalog)` 和请求构造器仍然严格，目录外的模型抛出 `model_contract_unavailable`；要把请求限定在该目录内，请显式调用它们。

提交失败的错误携带本次 `idempotencyKey`，可用原请求体和该键恢复，不能换键重新生成。`client.getBalance()` 可按需读取余额，不是提交前置条件。新请求省略 `billing_mode`；`gateway_fee`、`supply_type`、`billed_by` 仅保留兼容，已标记弃用。

## 参数控件

`describeModelParameters(operation, inputMode, current, referenceRoles)` 把一个操作合同转成表单字段：名称、类型、`control` 控件提示、`required`、当前值（未设置时为公开默认值）、`options`、数值范围与多语言文案。`describeReferences(constraint, referenceRoles)` 汇总某个输入模式的上传限制：总数与每种角色的最少、最多、已有数量和 `remaining`，必填角色、`required_any` 与 `prompt_optional`。`defaultModelParameters(operation)` 返回用于预填表单的公开默认值。三者都是 `@yir-ai/sdk/frontend` 与 `@yir-ai/sdk/browser` 中的纯函数，只读调用方传入的合同（`client.getModelContracts()` 或 `yir-models` 快照），不联网、不计价，也不改动调用方的取值。

只应用合同声明的条件。目前是 `max_duration_by_reference_role`：存在该角色参考素材时，`duration` 返回更低的 `maximum` 并带 `maximum_reason: "reference_duration_limit"`，超出的离散选项标记 `disabled` 而不删除。其他组合仍由 Gateway 在报价或提交时校验，读取 `error.details`。`type_known: false` 表示类型比本 SDK 新，渲染通用输入框即可。合同不含价格：请对请求报价，或使用自己的价格表，只展示已定价的选项。

```ts
import { findModelOperationContract, describeModelParameters, describeReferences } from '@yir-ai/sdk/frontend';

const operation = findModelOperationContract(catalog, 'google/nano-banana-pro', 'generate_image', 'image');
if (operation) {
  const fields = describeModelParameters(operation, 'image', form.parameters, form.references.map(r => r.role));
  const slots = describeReferences(operation.input_constraints.image!, form.references.map(r => r.role));
}
```

## 文件与 Webhook

媒体引用二选一：`file_id`（ready 的文件）或 `url`（公开 HTTPS 地址，Yir 在提交时导入，最大 100 MiB，拒绝 data URL）。更大或不可公开访问的媒体使用文件上传。`completeFile` 可能返回 `processing`，`uploadFile` 默认最多等待五分钟到 `ready`，也可用 `waitForFileReady` 继续等待已保存的文件 ID。等待超时不会取消服务端分析。AI SDK 适配器上传内联字节，并将公开 HTTPS URL 交给 Gateway 导入；混合 URL 与字节输入时保留顺序和引用角色，适配器不自行下载 URL。

参考输入合同声明了 `subject_references` 的模型（Kling 3.0）支持照片作角色：给 `reference_image` 设置相同的 `subject`（字母、数字或 `_`，以字母开头）即可把 2–4 张照片归为一个角色，并在提示词中以 `@subject` 引用。只要有一张带 subject，所有参考都必须带。角色请求按 `subject_references` 列出的分辨率、画幅、时长与音频取值校验，不用操作默认值；本地校验同样切换。

`createFiles(request, key)` 创建上传计划；`uploadFile(client, plan, blob)` 上传并完成计划；`createAndUploadFile(client, metadata, blob, key)` 合并这些步骤。使用稳定上传键并保留文件 ID；`getFile(id)` 查询状态，`completeFile(id)` 完成手动上传。生成请求仅引用 ready 文件，使用 `file_id` 和相应 role。上传辅助函数支持服务端的单段及分段计划。

`getFileContentURL(id)` 返回 ready 文件的短时签名 URL。Node 传输以 `redirect: "manual"` 从 307 响应的 `Location` 头读取该 URL，从不跟随跳转，因此 API Key 不会发给存储端。请求该 URL 时不要带 Gateway 凭据；过期后重新获取。只接受绝对 `https` URL，其余情况以 `file_content_response_invalid` 拒绝，错误中不含该 URL。文件不存在以 `YirAPIError` 404 `YIR_FILE_NOT_FOUND` 拒绝；尚未 ready 返回 409 `YIR_FILE_NOT_READY`（用 `waitForFileReady` 等待后重试）；已过期返回 410 `YIR_FILE_EXPIRED`（需重新上传）。

提交请求可设置 `webhook_url`。用账户 Webhook secret（不是 API Key）调用 `verifyWebhookSignature({ secret, id, timestamp, signature, rawBody })`。传入 JSON 解析前的原始字节，将回调签名元数据映射到 `id`、`timestamp` 和 `signature`。默认时钟容差为 300 秒。拒绝无效结果，按 Webhook ID 持久化去重；即使轮询也观察到终态，仍只结算一次。`constructWebhookEvent` 校验同样的字段，返回 `{ id, timestamp, job }`，失败时抛出带稳定 `reason` 的 `YirWebhookVerificationError`。`reason` 为 `unsupported_event` 表示签名有效，但请求体不是本 SDK 能识别的终态 Job（例如比 SDK 更新的事件类型）：返回 2xx 确认收到，记录日志，并按其 `id` 去重。其他原因返回 4xx。持久化工作流可把 Webhook 当作唤醒信号，再用 `getJob` 回读，并保留 `pollDelayMs` 轮询兜底。

## Vercel AI SDK

核心参数组合、服务端限制及迁移边界见[兼容矩阵](../vercel-compatibility.md)。

显式原生比例优先于目录推断。视频带媒体输入时，若传入的 `modelContracts` 在对应模型与输入模式中只声明 `auto`、未声明 `adaptive`，AI SDK 的 `aspectRatio: "adaptive"` 会映射为原生 `"auto"`。未配置目录时，可同时显式传入 `providerOptions.yir.parameters.aspect_ratio: "auto"`；否则仍原样透传 `adaptive`。适配器不会额外获取目录，也不改变省略参数的默认行为。自动时长仍通过原生选项 `providerOptions.yir.parameters.duration: "auto"` 传入，仅适用于支持该值的视频参考模式。

在应用中运行 `pnpm add ai@7.0.97` 安装适配器已测试的 AI SDK 版本。由 `@yir-ai/sdk/vercel` 导入 `createYirAIProvider`，选择 `provider.imageModel(modelId)` 或 `provider.videoModel(modelId)`；也可使用等价别名 `provider.image(modelId)` 和 `provider.video(modelId)`。适配目标是 AI SDK 7 / Provider V4，不是旧接口；另已通过 `ai@7.0.137` / `@ai-sdk/provider@4.0.26` 的编译与运行验证。

`providerOptions.yir.idempotencyKey` 可选，优先于调用级 `Idempotency-Key` 请求头。省略时使用该请求头（包括 AI SDK 视频调用生成、在外层重试间保持不变的键），再缺省则随机生成。图片调用若允许 AI SDK 外层重试，应通过上述任一方式传入已保存的键。需要恢复时传入已保存的键，以及 `maxCost`、`parameters` 和可选 `routing`。调用前完成报价和审批；适配器不报价、不审批预算、不持久化请求。图像路径提交、等待并下载结果；视频路径启动任务，返回含 `jobId` 和 `modelId` 的可序列化 operation 用于状态恢复，应保存它。内联引用文件的上传键由同次生成键派生，恢复时须保留相同字节。

图像 mask 仍不支持；图片 `size` 和视频像素 `resolution` 原样映射到可选的 `parameters.size`，没有明确支持该尺寸的模型/渠道时由 Gateway 拒绝。`seed` 与视频 `fps` 映射为同名 Yir 参数并发送给 Gateway，不因本地目录缺少字段而丢弃。通用参数与 Yir 参数冲突会被拒绝。可执行调用和映射见 [Vercel 测试](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs)。

开启 `providerOptions.yir.parameters.return_last_frame` 时，`videos` 只包含视频。尾帧等附加文件保留在 `providerMetadata.yir.additionalFiles`，沿用 Yir 文件字段（`url`、`media_type`、`expires_at` 及可选元数据），不会被当作视频下载。Job 结果警告（包括 `additional_results_unavailable`）与参数提示一起出现在 AI SDK `warnings`。原生 Job 的 `result.files` 保持不变。

图片模型通过 `supportsFileInputs` 表示调用方提供的目录是否声明参考图编辑能力，未知时为 `undefined`；`supportsMaskInputs` 固定为 `false`。这些是能力提示，不是准入校验：不会自动请求目录，也不会用旧快照阻止生成。需要时刷新目录，最终由 Gateway 校验。

`generateVideo({ webhook })` 会调用标准回调工厂，并通过 `webhook_url` 提交其地址。接收端须用 `constructWebhookEvent` 验签并确认对应任务，再 resolve `received`。通知只唤醒对原 Job 的回读，不用回调正文作为结果；未传 `webhook` 时保持轮询。首帧视频输入仅在 Gateway 模型及渠道声明 `prompt_optional` 时允许省略文字（首批为 Google Veo 3.1 官方渠道）；纯文本仍必填，不自动编造提示词。需要部署对应 Gateway 支持。

### 参数兼容边界

| AI SDK 输入 | Yir Standard API 映射与限制 |
| --- | --- |
| `prompt`、`aspectRatio`、`n` | `input.prompt`、`parameters.aspect_ratio`、`parameters.n`，仍受模型规格限制。 |
| 视频 `duration`、`generateAudio` | `parameters.duration`（整数秒）、`parameters.generate_audio`；保留显式 `false`。 |
| `seed`、视频 `fps` | 原值透传给 Gateway，不受本地旧目录影响。显式 `fps` 需要模型和渠道声明；首批仅 `google/veo-3.1-generate-001` 官方 Google 渠道接受原生 `24`。其他值或未声明渠道明确拒绝，不补帧或转码；省略时保持旧行为，需要 Gateway 已部署 FPS 支持。 |
| 图片 `size`、视频 `resolution` | 原样映射到 `parameters.size`，不近似换档。首批支持 Gateway 声明的 Seedream 5.0 Pro 官方图片尺寸；视频当前无声明渠道，由 Gateway 拒绝。省略尺寸保留旧默认值，显式档位/画幅冲突时拒绝。需要 Gateway 已部署精确尺寸支持。 |
| 图片 `prompt.images`、视频 `prompt.image` | 接受字节、Base64 或公开 HTTPS URL 字符串；视频图片映射为 `first_frame`。 |
| 视频 `frameImages` | 保留首尾帧角色；不会重复上传 AI SDK 同时传入的首帧镜像；`prompt.image` 加尾帧保留两端。 |
| 视频 `inputReferences` | 支持图片、视频、音频引用；URL 引用须显式提供 `mediaType`，适配器据此确定角色。 |
| 图片 `mask` | 不支持，Yir Standard API 没有 mask 角色。 |
| `headers`、`abortSignal` | 支持调用级 `Idempotency-Key`，其他自定义 headers 仍被拒绝；在客户端传输配置中设置。Abort 只停止本地等待，不取消服务端 Job。 |

适配器不会把 `n` 自动拆成多笔收费任务。视频 operation、Yir 路由、预算与账单元数据属于 Provider 专有能力；切换 Provider 时须显式迁移这些字段。

## 升级到 0.13.0

0.13.0 是包含不兼容类型变更的 minor 版本。所依赖的网关能力均已上线。

不兼容变更：

- `YirClient` 新增 `quoteAudio` 与 `submitAudio`。自行实现 `YirClient` 的代码需补上；使用 `createNodeYirClient` 的调用方无需改动。
- `Quote.operation` 新增 `generate_sound_effect`、`generate_speech`，并以 `(string & {})` 放宽；穷举的 `switch` 需要 default 分支。

新增：

- Demo 模式：`createNodeYirClient` 与 `createYirClient`（第三个参数）的 `demo` 选项，或 `YIR_DEMO=1`；`isDemoJobID`、`YirDemoOptions`、`YirDemoScenario`、`DEMO_ASSET_BASE_URL`。所有客户端都在本地解答 `demo_` Job ID。见 [Demo 模式](#demo-模式)。
- `/v1/audio` 接口的 `quoteAudio` / `submitAudio`（音乐、音效与语音合成；`quoteMusic` / `submitMusic` 保留为别名）、`StandardMusicParameters.voice`，以及 `GenerationOperation` 与 `quoteBatch` 中的 `generate_sound_effect` / `generate_speech`。
- 有序中间帧的参考角色 `keyframe`；模型合同与 `validateGeneration` 支持 `subject_references.mixed` 混合主体、主体声音（`max_audios_per_subject`、`max_audio_only_subjects`）和视频主体（`max_videos_per_subject`、`max_video_subjects`）。
- `ParameterNotice.disposition` 新增 `exceeded`，表示结果超出请求。
- 在注入 `client` 的同时传入 `demo` 时，`createYirAIProvider` 抛出 `demo_requires_client_option`。

## 升级到 0.12.0

0.12.0 是包含不兼容类型变化的 minor 版本，所依赖的 Gateway 功能均已上线。

不兼容变化：

- `YirClient` 新增 `quoteMusic` 与 `submitMusic`。自行实现 `YirClient` 的代码须补上这两个方法；使用 `createNodeYirClient` 的调用方无需改动。
- `QuoteParameters.resolution` 与 `aspect_ratio` 在类型上改为可选，因为音乐报价回显不含这两项。图片和视频回显仍然包含，使用前先收窄类型。

新增：

- `quoteMusic`、`submitMusic`、`StandardMusic*` 请求类型、`quoteBatch` 的 `generate_music` 项、`JobResultFile.duration_ms`，以及 `QuoteParameters.instrumental` / `lyrics_optimizer`。
- 客户端选项 `referralCode`，作为 `Yir-Referral` 发送。
- Account API 类型包含路由配置的 `excluded_model_providers`。

## 升级到 0.11.0

0.11.0 是包含不兼容变化的 minor 版本，所依赖的 Gateway 功能均已上线。

不兼容变化：

- 报价与提交客户端不再按传入的目录快照拒绝请求，只校验协议骨架，模型参数交给 Gateway 校验。参数非法时改为 `YirAPIError` `YIR_INVALID_REQUEST`（字段见 `error.details`），不再是 `YirSDKValidationError`。需要本地严格校验时显式调用 `validateGeneration(operation, request, catalog)`。
- Vercel 适配器：`seed` 与视频 `fps` 即使目录未声明也会透传，不再丢弃并返回 `unsupported` 警告；图片 `size` 与视频像素 `resolution` 映射为 `parameters.size`，不再视为不支持。模型或渠道未声明的取值由 Gateway 拒绝。
- `StandardVideoImageInput.prompt` 改为可选：模型声明 `prompt_optional` 时，首帧视频可以不带文字。
- 旧的 `billing_mode: "actual"` 请求不再要求 `routing.only`。

新增：

- 内置传输对网络错误和 HTTP 502/503/504 最多重试三次，保持原请求体与幂等键。提交失败时可读 `error.idempotencyKey`（`YirSubmissionError`）；`waitForJob` 在 Gateway 短暂不可用时继续等待已受理的 Job。
- `client.getBalance()`，以及用于 Account API 的 `createAccountClient`。
- `YirPublicError.provider_error`、错误码 `YIR_INPUT_REJECTED` 与 `Job.billing.status`（`pending` 或 `settled`）。
- 模型合同新增 `string_values`（如 Seedance 2.5 时长 `"auto"`，回显在 `QuoteParameters.duration`）、`prompt_optional` 与可选的原生 `fps`；没有在售渠道的市场规格予以保留。
- 表单辅助函数 `defaultModelParameters`、`describeModelParameters`、`describeReferences`，见[参数控件](#参数控件)。
- Vercel 适配器：`provider.image()`、`provider.video()` 别名，`supportsFileInputs`，公网 HTTPS URL 输入，保留首尾帧，Webhook 工厂，调用级 `Idempotency-Key` 头，自适应比例映射，`return_last_frame` 额外输出放在 `providerMetadata.yir.additionalFiles` 并附结果警告。

## 0.10.2 变化

0.10.2 为兼容版本：

- Cloudflare Workers/workerd 可使用服务端传输、文件上传与 AI SDK 图片下载。意外重定向会被拒绝，不重放请求、不转发凭据；只有显式的文件内容操作返回签名跳转 URL。

- 新增可选的 `Quote.expected_amount`（十进制字符串）：首选渠道的准入估价，Yir 核对余额、API Key 月度上限和 `max_cost` 都用它。与只估输出的 `estimate` 类价格不同，它包含参考图等已知输入费用，按用量计费的渠道还参考近期实收。没有匹配渠道或缺少可靠估价时不返回。报价校验要求它是十进制数，且没有供应时不得出现。作为成本参考时优先用它而不是 `primary.amount`；它不是上限。

## 0.10.1 变化

0.10.1 为兼容版本，跟进网关的参数回显与目录缓存变化：

- `Quote.parameters`（新增 `QuoteParameters` 类型）只回显模型合同声明的参数，按合同写法，省略的参数补默认值：`duration`、`generate_audio` 在类型中改为可选，图片报价和没有该参数的视频模型不再出现。模型专属参数按合同名回显。
- `Job.parameters` 自创建起携带同样的回显，应用可据此核对交付结果与扣费参数。
- 模型合同参数的 `required` 现在表示“没有默认值、请求必须传”；带 `default` 的参数一律 `required: false`，可以省略。`validateGeneration` 本来就先补默认值再检查 `required`，本地校验行为不变。
- `GET /v1/models` 与 `view=contract` 响应带 `ETag`（即加引号的目录 `version`）和 `Cache-Control: private, max-age=300`，并对 `If-None-Match` 回 304。`getModelContracts` 暂不发条件请求，自定义 transport 可以。

## 升级到 0.10.0

0.10.0 为 minor 版本，含不兼容变更，为 1.0 合同做准备。从 0.8 升级请先看 [0.9.0 说明](CHANGELOG.md#090-变化)；0.9.0 未单独发布，随本版本一起发布。

- 移除内置模型目录：`listModelContracts`、`getModelContract`、`getModelOperationContract`、`KnownModelID` 与 `@yir-ai/sdk/model-contracts` 入口已删除。用 `client.getModelContracts()` 获取目录（或据此生成 `models.ts`），再用 `findModelContract`、`findModelOperationContract` 与 `validateGeneration(operation, request, catalog)`。新增模型和参数调整都不需要发布 SDK。
- Job ID 是不透明字符串。任何非空、不超过 64 个字符、可安全作为一段 URL 路径的 ID 都会被接受（`isValidJobID`）；按字符串保存，不要解析。
- 未配置目录时，报价可能把你传入的别名回显为 `creator/model` 形式的规范 ID，其他不同的模型会校验失败；配置目录时按解析后的 ID 比对。Vercel 视频适配器不再要求 `job.model` 等于创建时使用的别名。
- `YirPublicError.details`（`YirErrorDetail[]`）定位 `YIR_INVALID_REQUEST` 的无效字段：`field`、稳定的 `reason`（如 `unsupported`、`required`）以及合同允许值 `allowed`。
- `StandardMediaSource` 与 `StandardReference` 除 `file_id` 外也接受 `url`，与 API 一致；`buildImageGenerationRequest` 接受 `image: { url }`。
- 0.10.0 的 Vercel 适配器曾按目录丢弃未声明的 `seed`、视频 `fps`；0.11.0 已改为透传，由 Gateway 判断。
- Veo 3.0（`google/veo-3.0-generate-001`）与 Gemini Omni 预览版（`google/gemini-omni-video`）已下架：API 目录和早期版本内置的审阅快照中都已移除。请求它们会返回 `YIR_INVALID_REQUEST`，`details[0].reason` 为 `retired`，`allowed` 给出替代模型。
- 与本 SDK 同批发布的 Gateway 变化：`parameters` 必填；不再接受顶层 `resolution`、`aspect_ratio`、`n`、`duration`、`generate_audio`、`input.image`，以及大小写不同的 `input.type` 或参考角色；`resolution` 与 `aspect_ratio` 必须是模型合同中的取值（不区分大小写），`1024`、`2048x2048`、`16x9` 等写法会被拒绝。模型别名精简为短名、厂商模型 ID，以及存在时的 Vercel AI Gateway ID；建议使用 `bytedance/seedance-2.0` 这类规范 ID。

更早的版本说明见[变更记录](CHANGELOG.md)。

## 验证和维护

在 `typescript/` 执行 `pnpm check`，验证生成合同、测试、类型、浏览器边界及实际归档安装。公开快照使用 `pnpm generate:model-contracts` 和 `pnpm check:model-contracts`。Node 产物保留在本子目录。[MIT 许可证](../../LICENSE)。

结果完成与费用结清独立：`billing.status` 为 `pending` 时，当前金额仍可增加；为 `settled` 后才按 Job ID 完成一次费用对账。结果立即通知，延迟账单结清后另发 `job.billing_settled`；事件按事件 ID 去重，结果履约与费用入账分别按 Job ID 去重。也可继续查询 Job。旧服务缺少状态或未知状态时，不应依据 0 元推断结清。新请求省略 `billing_mode`；历史请求重试保留原始请求体与幂等键，包括原有字段。
