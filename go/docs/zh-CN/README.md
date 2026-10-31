# Yir Go SDK

> 内测阶段（0.x）。不兼容变更只随 minor 版本发布，迁移说明写在 README 与[变更记录](CHANGELOG.md)中。比 SDK 新的字段和取值按数据读取，新增模型与选项无需升级 SDK。

[English](../../README.md) | 简体中文 · [仓库总览](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/README.md) · [示例](examples.md)

服务端图像与视频 API 客户端。要求 Go 1.25+，模块为 `github.com/yir-ai/sdk/go`，采用 [MIT](../../LICENSE) 许可证。

`parameters.n` 表示**单次 API 请求（一个 Job）的输出数量**，允许值不代表应用的批量张数。例如，模型只接受 `n=1` 时，应用仍可提交四个独立 Job 生成四张图片。批量数量控件应与模型的 `n` 参数分开维护；每个 Job 分别报价，并拥有独立的幂等键、状态和账单。

## 安装

在应用的 Go 模块中执行：

```sh
go get github.com/yir-ai/sdk/go@latest
```

模块标签使用 `go/vX.Y.Z`，此版本对应 `go/v0.13.0`。模块包含必要测试向量，不需要 Node 或仓库的 `spec/`。

```go
import (
    "os"
    yir "github.com/yir-ai/sdk/go"
)

// 在服务端函数内使用；构造客户端不发送 API 请求。
client, err := yir.NewClient(os.Getenv("YIR_API_KEY"), yir.ClientOptions{})
if err != nil {
    return err
}
_ = client
```

密钥保留在服务端。默认地址是 `https://gateway.yir.ai`，按需配置 `ClientOptions.BaseURL` 和 `ClientOptions.HTTPClient`。默认 HTTP 超时为 30 秒，拒绝重定向。如果你发布的应用由他人用自己或其用户的 Key 部署，把 `ClientOptions.ReferralCode` 设为你的 Yir 推广码；它作为 `Yir-Referral` 发送，Yir 为该码开通合作归因后，这些 Job 计入你的邀请返利，否则该请求头被忽略。

## 升级到 0.13.0

0.13.0 是 minor 版本，与 0.12.0 兼容。所依赖的网关能力均已上线。

新增：

- Demo 模式：`ClientOptions.Demo`（`DemoOptions`、`DemoScenario*`）、`IsDemoJobID` 与 `DemoAssetBaseURL`。所有 `Client` 都在本地解答 `demo_` Job ID。见 [Demo 模式](#demo-模式)。
- `/v1/audio` 接口的 `QuoteAudio` / `SubmitAudio`（音乐、音效与语音合成；`QuoteMusic` / `SubmitMusic` 保留为别名）、`voice` 参数，以及 `generate_sound_effect` / `generate_speech` 报价与 `QuoteBatch` 项。
- 有序中间帧的参考角色 `keyframe`；模型合同与 `ValidateGenerationWithCatalog` 支持混合主体、主体声音和视频主体。
- 参数说明的 disposition 新增 `exceeded`，表示结果超出请求。

## 升级到 0.12.0

0.12.0 是包含不兼容行为变化的 minor 版本，导出 API 只有新增。0.11.2 未单独发布，其[变化](#0112-变化)随本版本一并发布。所依赖的 Gateway 功能均已上线。

不兼容变化：

- 报价与提交不再按 `ClientOptions.ModelContracts` 校验模型参数，只校验协议骨架，交给 Gateway 校验。参数非法时返回带 `ErrCodeInvalidRequest` 的 `*APIError`（字段见 `Details`），不再是本地的 `*ParameterError`。需要本地严格校验时调用 `ValidateGenerationWithCatalog`。
- 提交失败返回 `*SubmissionError`，携带 `IdempotencyKey` 并包装传输或 API 错误。用 `errors.As` 取得 `*APIError`；直接对返回错误做类型断言将不再匹配。
- `HTTPClient.Timeout`（默认 30 秒）限制整次调用，包括下文的传输重试。
- 旧的 `BillingMode: "actual"` 请求不再要求 `Routing.Only`。

新增：

- 读取请求和带幂等键的生成提交遇到网络错误或 HTTP 502/503/504 时，最多重试三次，保持原请求体与幂等键；遵守不超过一分钟的 `Retry-After`。`WaitJob` 在 Gateway 短暂不可用时继续等待已受理的 Job，并等待 `429 YIR_RATE_LIMITED`（`APIError.RetryAfter`）过去。
- `QuoteAudio`、`SubmitAudio`（旧名 `QuoteMusic` / `SubmitMusic`）、`GenerationInput.Lyrics` 与 `ResultFile.DurationMS`，见[报价与提交](#报价与提交)。
- `ClientOptions.ReferralCode`，作为 `Yir-Referral` 发送。
- `client.GetBalance`，以及用于 Account API 的 `NewAccountClient`，含路由配置的 `ExcludedModelProviders`。
- `Routing.Fidelity`（`RoutingFidelity*`、`ErrCodeFidelityExcluded`）、`Routing.Accelerate`，以及每个结果文件的 `ResultFile.Fidelity`。
- `APIError.ProviderError`、`ErrCodeInputRejected` 与 `JobBilling.Status`（`pending` 或 `settled`）。
- 模型合同新增 `StringValues`（如 Seedance 2.5 时长 `"auto"`，报价与 Job 参数回显中保留）和 `PromptOptional`；没有在售渠道的市场规格予以保留。

## 0.11.2 变化

0.11.2 为兼容版本：

- 新增可选的 `Quote.ExpectedAmount`（`*string`）：首选渠道的准入估价，Yir 核对余额、API Key 月度上限和 `max_cost` 都用它。与只估输出的 `estimate` 类价格不同，它包含参考图等已知输入费用，按用量计费的渠道还参考近期实收。没有匹配渠道或缺少可靠估价时不返回。`Validate` 要求它是十进制数，且没有供应时不得出现。作为成本参考时优先用它而不是 `Primary.Amount`；它不是上限。

## 0.11.1 变化

0.11.1 为兼容版本，跟进网关的参数回显与目录缓存变化：

- `Quote.Parameters` 只回显模型合同声明的参数，按合同写法，省略的参数补默认值：图片报价和没有该参数的视频模型不再出现 `duration`、`generate_audio`。模型专属参数按合同名回显。
- `Job.Parameters`（`map[string]any`）自创建起携带同样的回显，应用可据此核对交付结果与扣费参数。
- 模型合同参数的 `Required` 现在表示“没有默认值、请求必须传”；带 `Default` 的参数一律 `Required: false`，可以省略。`ValidateGenerationWithCatalog` 本来就先补默认值再检查 `Required`，本地校验行为不变。
- `GET /v1/models` 与 `view=contract` 响应带 `ETag`（即加引号的目录 `version`）和 `Cache-Control: private, max-age=300`，并对 `If-None-Match` 回 304。`GetModelContracts` 暂不发条件请求，自定义 `HTTPClient` 可以。

## 升级到 0.11.0

0.11.0 为 minor 版本，含不兼容变更，为 1.0 合同做准备。从 0.9 升级请先看 [0.10.0 说明](CHANGELOG.md#0100-变化)；0.10.0 未单独发布，随本版本一起发布。

- 移除内置模型目录：包级 `ListModelContracts`、`GetModelContract`、`GetModelOperationContract`、`ValidateGeneration` 与 `ValidateModelParameters` 已删除。用 `client.GetModelContracts` 获取目录，再传给 `ValidateGenerationWithCatalog` 或 `ClientOptions.ModelContracts`。新增模型和参数调整都不需要发布 SDK。
- Job ID 是不透明字符串。任何非空、不超过 64 个字符、可安全作为一段 URL 路径的 ID 都会被接受；按字符串保存，不要解析。
- 未配置目录时，报价可能把你传入的别名回显为 `creator/model` 形式的规范 ID，其他不同的模型会校验失败；配置目录时按解析后的 ID 比对。
- `APIError.Details`（`[]ErrorDetail`）定位 `YIR_INVALID_REQUEST` 的无效字段：`Field`、稳定的 `Reason`（如 `unsupported`、`required`）以及合同允许值 `Allowed`。
- Veo 3.0（`google/veo-3.0-generate-001`）与 Gemini Omni 预览版（`google/gemini-omni-video`）已下架：API 目录和早期版本内置的审阅快照中都已移除。请求它们会返回 `YIR_INVALID_REQUEST`，`details[0].reason` 为 `retired`，`allowed` 给出替代模型。
- 与本 SDK 同批发布的 Gateway 变化：`parameters` 必填；不再接受顶层 `resolution`、`aspect_ratio`、`n`、`duration`、`generate_audio`、`input.image`，以及大小写不同的 `input.type` 或参考角色；`resolution` 与 `aspect_ratio` 必须是模型合同中的取值（不区分大小写），`1024`、`2048x2048`、`16x9` 等写法会被拒绝。模型别名精简为短名、厂商模型 ID，以及存在时的 Vercel AI Gateway ID；建议使用 `bytedance/seedance-2.0` 这类规范 ID。

更早的版本说明见[变更记录](CHANGELOG.md)。

## 报价与提交

可直接调用 `SubmitImage(ctx, request)` 或 `SubmitVideo(ctx, request)`，SDK 每次调用生成随机幂等键。最后一个参数可传入一个非空且不含换行的显式键。Submit 不隐式重试；再次调用或跨进程恢复须复用已保存的键和完整请求。服务端同一 Job 内的故障转移不依赖客户端传键。

构造含 `Model`、`Input` 和明确 `Parameters` 的 `GenerationRequest`，使用 `QuoteImage` 或 `QuoteVideo`。要求 `Supply.Available` 且 `Primary` 有价格；该金额是估价，不是上限。审批新工作前检查过期时间。

应用审批预算后，持久化包含完整生成请求和 `MaxCost` 的 `SubmitRequest`，以及稳定幂等键；同时保存路由、引用和 `WebhookURL`。之后才调用 `SubmitImage(ctx, savedRequest, savedKey)` 或 `SubmitVideo`。报价不授权或触发生成。重试不得生成新键；传输结果未知时使用原请求与键恢复，不得悄悄用新报价或预算替换请求。

音乐与音效使用 `QuoteAudio` 和 `SubmitAudio`（`/v1/audio` 端点），流程相同；`QuoteMusic` / `SubmitMusic` 是它们的旧名，调用永久保留的旧路径 `/v1/music`，行为相同；也可在 `QuoteBatch` 中传 `generate_music` / `generate_sound_effect` 项。文本输入设置 `Input.Prompt`，模型支持自定义歌词时可设置 `Input.Lyrics`。Suno 模型还支持上传原曲翻唱（`Input.Type` 为 `"reference"`）：`Input.References` 中恰好一段 `reference_audio` 原曲（URL 或 File ID，不超过 8 分钟），`Input.Prompt` 写新风格，歌词规则与文本输入相同，价格与基础生成相同；`ValidateGenerationWithCatalog` 对其他音频模型拒绝该输入。`Parameters` 可省略，每个模型只接受其合同声明的参数（`n`、`duration`、`instrumental`、`lyrics_optimizer`）。带人声的音乐须使用模型支持的一种歌词来源：`Lyrics`、`lyrics_optimizer: true`（按提示词自动写词，部分模型另收写词费用，以报价为准）或 `instrumental: true`，三者互斥。ElevenLabs 音乐不接受歌词，按 `duration` 计价（30–300 秒固定档位，默认 60）；ElevenLabs 音效（`elevenlabs/sound-effects-v2`）只传描述，不接受歌词，`duration` 为 1–22 秒（默认 5），报价的 operation 为 `generate_sound_effect`。Suno（`suno/suno-v6`，非官方接入，Suno 没有官方 API）每次请求返回两首（`n` 固定为 2）。SDK 在发送前检查通用冲突；`ValidateGenerationWithCatalog` 还按模型合同检查 `n`、`duration` 与歌词来源，各模型的文本长度上限由 Gateway 校验。每个音频文件的实测时长见 `ResultFile.DurationMS`。音乐报价的参数回显不含 `resolution` 与 `aspect_ratio`。

文字转语音模型（`minimax/speech-2.8-hd`，最多 10000 字符；`elevenlabs/eleven-v3`，最多 5000 字符）同样使用 `QuoteAudio` / `SubmitAudio`，或在 `QuoteBatch` 中传 `generate_speech` 项：`Input.Prompt` 即朗读文本，`Parameters` 只接受 `n`（1）与 `voice`（模型的预设音色 ID，省略则用模型默认音色，音色不影响价格），不接受歌词、`instrumental`、`lyrics_optimizer` 或 `duration`。报价的 operation 为 `generate_speech`，按提示词字符数计价（空格、标点与音频标签都计入），参数回显为 `n` 与 `voice`；Job 交付一个 MP3，实测时长见 `ResultFile.DurationMS`。

```go
request := yir.GenerationRequest{Model: "minimax/music-2.6", Input: yir.GenerationInput{
	Type: "text", Prompt: "A warm acoustic folk ballad", Lyrics: "[Verse]\nWalking down a dusty road"}}
quote, err := client.QuoteAudio(ctx, request)
job, err := client.SubmitAudio(ctx, yir.SubmitRequest{GenerationRequest: request, MaxCost: &maxCost}, savedKey)
```

3D 使用 `Quote3D` 和 `Submit3D`（`/v1/3d` 端点），流程相同；也可在 `QuoteBatch` 中传 `generate_3d` 项。`Input.Type` 为 `text`（填 `Prompt`）、`image`（恰好一张 `reference_image`，`Prompt` 留空）或 `multiview`（一张 `front_view` 加至少一张 `left_view`、`back_view` 或 `right_view`，每个角色至多一张，`Prompt` 留空；只限合同列出 multiview 输入方式的模型）。`Parameters` 可省略：`texture`（`none`、`standard`、`hd`）、`pbr`（需要带贴图，`texture: "none"` 同时 `pbr: true` 会被拒绝）、`face_limit`、`topology`（`triangle`、`quad`）与 `n`（固定为 1）；每个模型只接受其合同声明的取值，省略即模型默认。`ValidateGenerationWithCatalog("generate_3d", request, catalog)` 按模型合同检查输入方式、参考图与取值。Job 交付一个 glb 文件（`model/gltf-binary`），实测三角面数见 `ResultFile.Faces`；超规格结果（未要求的贴图或 PBR）照常交付，并给出参数通知。Demo 模式没有 3D 样例：`Submit3D` 不发送请求，直接返回 `ErrDemoOperationUnsupported`。

```go
model := yir.GenerationRequest{Model: "tripo/tripo-p2", Input: yir.GenerationInput{
	Type: "image", References: []yir.Reference{{Role: "reference_image", URL: "https://example.com/chair.png"}}},
	Parameters: map[string]any{"texture": "standard", "pbr": false}}
quote, err := client.Quote3D(ctx, model)
job, err := client.Submit3D(ctx, yir.SubmitRequest{GenerationRequest: model, MaxCost: &maxCost}, savedKey)
```

见[编译检查示例](../../client_example_test.go)和[集成指南](examples.md)。示例将客户授权及持久化留给应用实现。

计费：不冻结余额。上游实际计费的每个 Attempt 都按上游权威金额乘托管折扣收取，包括失败的 Attempt 和其后发生回退的 Attempt；上游未计费的 Attempt，以及 Yir 自身的交付失败和结果超时，不收费。`MaxCost` 封顶整个 Job 的总费用，并跳过估价超过它的路线。报价的主价格是估价，不是上限。报价后价格可能变化：较便宜的渠道可能下线或冷却，路由默认值可能改变可用渠道，目录价格也可能调整。把 `MaxCost` 当作在报价之上留有余量的失控兜底，而不是锁价；上限设得等于报价时，可能开始以 `YIR_BUDGET_EXCEEDED` 失败（提交时返回 422 并给出当前最低估价，或出现在 Job 上）。收到该错误时先重新报价，由应用决定是否在新请求中调高上限，不要自动调高。

新请求默认按渠道实际账单结算，无需选择计费模式。缺少可靠估价的渠道仍可能可用，但不能接受 `max_cost`；需要上限时请选择能够估价的渠道。未知价格不等于免费。

## 任务、文件与 Webhook

保存返回的任务 ID。`GetJob` 查询完整任务详情，`GetJobStatus` 查询轻量状态摘要 `JobStatusResponse`。`WaitJob` 默认长轮询状态摘要：`GetJobStatusWithWait` 让 Gateway 挂起查询直到状态变化（最长 30 秒），`WaitOptions.StatusWait` 默认 `DefaultStatusWait`（20 秒，自动收进 HTTP 客户端超时与 context 截止时间之内；负值关闭），无需 Webhook，Yir 记录终态后约 1 秒即可拿到。Gateway 未挂起直接返回时，回退到 `PollDelay` 退避（前 30 秒每 5 秒，约 90 秒内每 10 秒，之后每 20 秒）；设置 `WaitOptions.PollInterval` 可改为固定间隔。状态查询遇到 `429 YIR_RATE_LIMITED`（按 API Key 的每分钟请求上限）时按 `Retry-After`（`APIError.RetryAfter`，缺省 1 秒，最长 1 分钟）等待后继续，连续最多 5 次。进入终态后只读取一次完整 `Job`，若终态摘要与详情状态不符返回 `ErrJobStateInconsistent`。取消或超时 context 只停止本地等待，返回零值 `Job{}`，不取消远端任务或表示退款；用保存的 ID 恢复。`JobError` 包含失败或取消的终态任务；`APIError` 包含 HTTP status、code、message、retryable 和 action。业务判断使用稳定错误码。

`CancelJob` 显式申请取消，应检查取消状态和终态账单，不假定立即成功或零费用。每个任务的 `Billing.TotalChargedByYir` 只结算一次，包括错误路径；`ComputeCharges`、`GatewayFee` 和 `OfficialComparison` 说明该总额的构成。`APIError.Code` 应与 `ErrCode*` 常量比较，而非字符串字面量。`APIError.RequestID` 是失败 HTTP 请求的 `request_id`，联系 Yir 支持时请一并提供。

`Job`、`JobStatusResponse`、`Quote`、`File` 和 `ModelDetail` 保留解码时的原始 JSON：`RawJSON()` 返回它，因此比 SDK 更新的字段（包括新的账单明细等嵌套字段）可以在 SDK 发版前用 `json.Unmarshal` 读取。代码中直接构造的值返回 `nil`；经过 `json.Marshal` 再解码的值返回重新编码后的内容。

媒体引用二选一：`FileID`（ready 的文件）或 `URL`（公开 HTTPS 地址，Yir 在提交时导入，最大 100 MiB，拒绝 data URL）。更大或不可公开访问的媒体使用文件上传。`CompleteFile` 可能返回 `processing`，`UploadFile` 默认最多等待五分钟到 `ready`。可用 `WaitForFileReady` 继续等待已保存的文件 ID；本地等待超时不会取消服务端分析。

`CreateFiles(ctx, request, key)` 创建上传计划；`UploadFile(ctx, plan, source)` 从 `io.ReaderAt` 上传并完成文件；`CreateAndUploadFile(ctx, metadata, source, key)` 合并步骤。保留稳定上传键及文件 ID。`GetFile` 查询状态，`CompleteFile` 完成手动上传。生成引用使用 ready 文件的 `FileID` 和适当角色，支持单段与分段上传计划。

`GetFileContentURL(ctx, id)` 返回 ready 文件的短时签名 URL。SDK 从 307 响应的 `Location` 头读取该 URL，从不跟随跳转，因此 API Key 不会发给存储端。请求该 URL 时不要带 Gateway 凭据；过期后重新获取。只接受绝对 `https` URL，其余情况返回 `file_content_response_invalid`，错误中不含该 URL。文件不存在返回 `*APIError` 404 `YIR_FILE_NOT_FOUND`；尚未 ready 返回 409 `YIR_FILE_NOT_READY`（用 `WaitForFileReady` 等待后重试）；已过期返回 410 `YIR_FILE_EXPIRED`（需重新上传）。

使用 `SubmitRequest.WebhookURL` 设置回调。`VerifyWebhookSignature` 接受 `Secret`、`ID`、`Timestamp`、`Signature` 和 `RawBody`。使用账户 Webhook secret，不是 API Key；传入 JSON 解析前的原始字节，并将回调签名元数据映射到这些字段。默认时钟容差为 300 秒。检查返回 error 和 `Valid`；按 Webhook ID 持久化去重，即使轮询同时观察到终态仍只结算一次。`ConstructWebhookEvent` 校验同样的字段，返回 Webhook ID 与终态 `Job`，失败时返回带稳定 `Reason` 的 `*WebhookVerificationError`。`Reason` 为 `unsupported_event` 表示签名有效，但请求体不是本 SDK 能识别的终态 Job（例如比 SDK 更新的事件类型）：返回 2xx 确认收到，记录日志，并按其 `ID` 去重。其他原因返回 4xx。无法在 `WaitJob` 中阻塞的持久化工作流可把 Webhook 当作唤醒信号，再用 `GetJob` 回读，并保留 `PollDelay` 轮询兜底。

## Demo 模式

Demo 模式用于不花钱地测试完整生成流程：把 `ClientOptions.Demo` 设为 `&yir.DemoOptions{}`（Go SDK 不读环境变量，请自行映射开关）。提交照常做本地校验，再调用对应的报价接口（不扣费），参数仍由网关校验，但请求不会真正提交。提交返回一个 ID 以 `demo_` 开头的 demo Job，带报价返回的模型和参数回显。报价、文件、余额和模型接口照常访问网关，因此仍需要 API Key。

Demo Job 不保存状态：ID 里编码了创建时间、类型、画幅、`n`、时长、分辨率和场景，所以 `GetJob`、`GetJobStatusWithWait`（挂起到下一次状态变化）和 `WaitJob` 在任何进程里得到同样结果，不发网络请求，并与 TypeScript SDK 一致。所有 `Client` 都在本地解答 `demo_` ID，关闭 demo 模式后也一样；用 `IsDemoJobID(id)` 区分。图片排队 2 秒、8 秒后成功，视频 25 秒，音频 12 秒。结果指向 `DemoAssetBaseURL`（`https://public.yir.ai/demo/v1/`）下带 DEMO 徽标的固定文件，按类型和最接近的画幅（视频再按 5 或 10 秒）选取；`Width`、`Height`、`DurationMS` 是实际文件的值，请求的值保留在 `Parameters` 中。扣费恒为 `"0"`。

`DemoOptions.Scenario` 或提示词中的 `[demo:<scenario>]` 标记（标记优先）决定结果：`DemoScenarioOK`（默认）；`DemoScenarioSlow`，排队 6 分钟、8 分钟后成功；`DemoScenarioFail`，以 `YIR_EXECUTION_FAILED` 失败且不扣费；`DemoScenarioReject`，报价后提交返回 `*APIError` 422 `YIR_INPUT_REJECTED`（包在 `*SubmissionError` 里）；`DemoScenarioCancel`，以 `cancelled` 结束。对未结束的 demo Job 调用 `CancelJob` 返回 `cancelled`，对已结束的返回 409 `YIR_JOB_NOT_CANCELLABLE`；由于不保存状态，之后的读取仍按原时间线，请保留 `CancelJob` 返回的 Job。

提交返回报价的完整 `Parameters` 回显；之后按 ID 读取 demo Job 只保留 `n`、`aspect_ratio`、`resolution`、`duration` 四项（ID 装不下其余参数）。Demo 模式不覆盖：提交的幂等重放、余额/消费上限/`MaxCost` 准入错误、Webhook 投递、部分或过期结果、fallback 计费。

## 价格与合同

`GetModel(ctx, "creator/model")` 读取 Market `ModelDetail`：`Specifications` 及各渠道展示价格 `Channels`（未公布价格时 `AmountMicros` 为 `nil`），以及可选的 `ChannelParameters`。须传规范 ID，别名不能作为资源路径；非法 ID 在本地返回 `model_request_invalid`。SDK 忽略未知字段，并接受比 SDK 更新的操作、输入方式、币种、可用性取值和规则行为；但 ID 不一致或必填值缺失、为空时返回 `model_response_invalid`。模型不存在返回 `*APIError` 404 `YIR_MODEL_NOT_FOUND`。Market 价格仅供展示，提交前仍需报价。`GetModelContract` 仍用于读取带版本的参数合同（`view=contract`）。

通过 `ClientOptions.ModelContracts` 创建的客户端，只对该目录描述的模型、操作和输入方式校验参数与引用。其余请求（例如目录读取之后才上线的模型）只做协议检查，交由 Gateway 判断；需要对新模型做本地检查时，用 `GetModelContracts` 刷新目录。`ValidateGenerationWithCatalog` 仍然严格，目录外的模型返回 `model_contract_unavailable`；要把请求限定在该目录内，请自行调用它。

## 验证

在 `go/` 运行 `go test -p 2 ./...`，隔离验证时设置 `GOWORK=off` 和 `GOMAXPROCS=2`。无 `Output` 指令的示例仅编译、不执行。可选外部价格夹具缺失时跳过相关测试，不需要安装 Node。

结果完成与费用结清独立：`billing.status` 为 `pending` 时，当前金额仍可增加；为 `settled` 后才按 Job ID 完成一次费用对账。结果立即通知，延迟账单结清后另发 `job.billing_settled`；事件按事件 ID 去重，结果履约与费用入账分别按 Job ID 去重。也可继续查询 Job。旧服务缺少状态或未知状态时，不应依据 0 元推断结清。新请求省略 `billing_mode`；历史请求重试保留原始请求体与幂等键，包括原有字段。
