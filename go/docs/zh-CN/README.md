# Yir Go SDK

> 内测阶段（0.x）。不兼容变更只随 minor 版本发布，迁移说明写在[变更记录](CHANGELOG.md)中。比 SDK 新的字段和取值按数据读取，新增模型与选项无需升级 SDK。

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

## 快速开始

提交、等待、读取结果，完整流程就是这些。这段代码会从余额扣费；[Demo 模式](#demo-模式)可以免费跑通同样的流程。

```go
request := yir.GenerationRequest{
	Model:      "openai/gpt-image-2",
	Input:      yir.GenerationInput{Type: "text", Prompt: "A quiet observatory"},
	Parameters: map[string]any{"resolution": "1K", "aspect_ratio": "1:1", "n": 1},
}
// 幂等键由你提供并保持稳定：同一请求加同一个键不会创建第二个 Job。
job, err := client.SubmitImage(ctx, yir.SubmitRequest{GenerationRequest: request}, "task-123")
if err != nil {
	return err // yir.SubmissionNotAccepted(err) 可判断是否确定没有创建 Job
}
job, err = client.WaitJob(ctx, job.ID, yir.WaitOptions{})
if err != nil {
	return err // *yir.JobError 带有失败或已取消的 Job
}
fmt.Println(job.Result.Files[0].URL, job.Billing.TotalChargedByYir)
```

结果链接短期有效，过期前把文件存到自己的存储。想在花钱前看价格，调用 `QuoteImage` 读 `ExpectedAmount`。实际花费是 `Billing.Status` 变为 `settled` 后的 `Billing.TotalChargedByYir`。本页其余部分讲恢复、预算、文件和 Webhook。

## 升级

各版本的发布说明与迁移步骤见[变更记录](CHANGELOG.md)。

## 报价与提交

可直接调用 `SubmitImage(ctx, request)` 或 `SubmitVideo(ctx, request)`，SDK 每次调用生成随机幂等键。最后一个参数可传入一个非空且不含换行的显式键。内置传输对网络故障与 HTTP 502/503/504 最多重试 3 次，复用同一幂等键与请求体。若提交在某次结果不明的尝试（网络错误、响应中途断开或 502/503/504）之后仍失败，返回的错误含 `*SubmissionUncertainError`（用 `errors.As` 取得），即使最后一次是 429、402 等拒绝；它有意不向下 Unwrap，`errors.As(err, &apiErr)` 匹配不到那次拒绝（需要时读 `Err` 字段）。把 `*APIError` 判为“未受理”之前先检查它：先前的尝试可能已创建并计费 Job，应以其 `IdempotencyKey` 重新提交完整原请求，不能当作未受理。再次调用或跨进程恢复须复用已保存的键和完整请求。服务端同一 Job 内的故障转移不依赖客户端传键。

构造含 `Model`、`Input` 和明确 `Parameters` 的 `GenerationRequest`，使用 `QuoteImage` 或 `QuoteVideo`。要求 `Supply.Available`。展示和做预算时看 `ExpectedAmount`：按当前首选渠道估算的这个 Job 大概要花多少，已含已知的输入费用。没有可靠估价时它不存在；`Primary`（目录参考价或只含输出的估价）、`Official` 和 `PriceDifferencePercent` 用于价格展示与对比。报价里的任何金额都不是上限。审批新工作前检查过期时间。

应用审批花费后，持久化完整的 `SubmitRequest` 和稳定幂等键；同时保存路由、引用和 `WebhookURL`。`MaxCost` 可选，默认建议不传：它用来防止费用失控，不是锁价（见下方警告）。之后才调用 `SubmitImage(ctx, savedRequest, savedKey)` 或 `SubmitVideo`。报价不授权或触发生成。重试不得生成新键；传输结果未知时使用原请求与键恢复，不得悄悄用新报价或预算替换请求。

提交失败时，`SubmissionNotAccepted(err)` 判断这个错误是否足以证明没有创建 Job、幂等键也没有被占用：SDK 在发送前拒绝的请求，或带 Yir 错误码的 4xx 拒绝（408、`YIR_IDEMPOTENCY_CONFLICT` 与 `YIR_JOB_NOT_FOUND` 除外）。只有这时才能放心释放自己的预留或给用户退款。其余错误（`*SubmissionUncertainError`、网络错误、5xx）都可能已经创建了 Job：用同一请求和同一个键重新提交。这个判断只针对当次调用：如果同一个键此前有过结果不明的调用，那次调用可能已经创建了 Job，之后的拒绝不能排除这一点。

音乐与音效使用 `QuoteAudio` 和 `SubmitAudio`（`/v1/audio` 端点），流程相同；`QuoteMusic` / `SubmitMusic` 是它们的旧名，调用永久保留的旧路径 `/v1/music`，行为相同；也可在 `QuoteBatch` 中传 `generate_music` / `generate_sound_effect` 项。文本输入设置 `Input.Prompt`，模型支持自定义歌词时可设置 `Input.Lyrics`。Suno 模型还支持上传原曲翻唱（`Input.Type` 为 `"reference"`）：`Input.References` 中恰好一段 `reference_audio` 原曲（URL 或 File ID，不超过 8 分钟），`Input.Prompt` 写新风格，歌词规则与文本输入相同，价格与基础生成相同；`ValidateGenerationWithCatalog` 对其他音频模型拒绝该输入。`Parameters` 可省略，每个模型只接受其合同声明的参数（`n`、`duration`、`instrumental`、`lyrics_optimizer`）。带人声的音乐须使用模型支持的一种歌词来源：`Lyrics`、`lyrics_optimizer: true`（按提示词自动写词，部分模型另收写词费用，以报价为准）或 `instrumental: true`，三者互斥。ElevenLabs 音乐不接受歌词，按 `duration` 计价（30–300 秒固定档位，默认 60）；ElevenLabs 音效（`elevenlabs/sound-effects-v2`）只传描述，不接受歌词，`duration` 为 1–22 秒（默认 5），报价的 operation 为 `generate_sound_effect`。Suno（`suno/suno-v6`，非官方接入，Suno 没有官方 API）每次请求返回两首（`n` 固定为 2）。SDK 在发送前检查通用冲突；`ValidateGenerationWithCatalog` 还按模型合同检查 `n`、`duration` 与歌词来源，各模型的文本长度上限由 Gateway 校验。每个音频文件的实测时长见 `ResultFile.DurationMS`。音乐报价的参数回显不含 `resolution` 与 `aspect_ratio`。

文字转语音模型（`minimax/speech-2.8-hd`，最多 10000 字符；`elevenlabs/eleven-v3`，最多 5000 字符）同样使用 `QuoteAudio` / `SubmitAudio`，或在 `QuoteBatch` 中传 `generate_speech` 项：`Input.Prompt` 即朗读文本，`Parameters` 只接受 `n`（1）与 `voice`（模型的预设音色 ID，省略则用模型默认音色，音色不影响价格），不接受歌词、`instrumental`、`lyrics_optimizer` 或 `duration`。报价的 operation 为 `generate_speech`，按提示词字符数计价（空格、标点与音频标签都计入），参数回显为 `n` 与 `voice`；Job 交付一个 MP3，实测时长见 `ResultFile.DurationMS`。

```go
request := yir.GenerationRequest{Model: "minimax/music-2.6", Input: yir.GenerationInput{
	Type: "text", Prompt: "A warm acoustic folk ballad", Lyrics: "[Verse]\nWalking down a dusty road"}}
quote, err := client.QuoteAudio(ctx, request)
job, err := client.SubmitAudio(ctx, yir.SubmitRequest{GenerationRequest: request}, savedKey)
```

3D 使用 `Quote3D` 和 `Submit3D`（`/v1/3d` 端点），流程相同；也可在 `QuoteBatch` 中传 `generate_3d` 项。`Input.Type` 为 `text`（填 `Prompt`）、`image`（恰好一张 `reference_image`，`Prompt` 留空）或 `multiview`（一张 `front_view` 加至少一张 `left_view`、`back_view` 或 `right_view`，每个角色至多一张，`Prompt` 留空；只限合同列出 multiview 输入方式的模型）。`Parameters` 可省略：`texture`（`none`、`standard`、`hd`）、`pbr`（需要带贴图，`texture: "none"` 同时 `pbr: true` 会被拒绝）、`face_limit`、`topology`（`triangle`、`quad`）与 `n`（固定为 1）；每个模型只接受其合同声明的取值，省略即模型默认。`ValidateGenerationWithCatalog("generate_3d", request, catalog)` 按模型合同检查输入方式、参考图与取值。Job 交付一个 glb 文件（`model/gltf-binary`），实测三角面数见 `ResultFile.Faces`；超规格结果（未要求的贴图或 PBR）照常交付，并给出参数通知。Demo 模式没有 3D 样例：`Submit3D` 不发送请求，直接返回 `ErrDemoOperationUnsupported`。

```go
model := yir.GenerationRequest{Model: "tripo/tripo-p2", Input: yir.GenerationInput{
	Type: "image", References: []yir.Reference{{Role: "reference_image", URL: "https://example.com/chair.png"}}},
	Parameters: map[string]any{"texture": "standard", "pbr": false}}
quote, err := client.Quote3D(ctx, model)
job, err := client.Submit3D(ctx, yir.SubmitRequest{GenerationRequest: model}, savedKey)
```

见[编译检查示例](../../client_example_test.go)和[集成指南](examples.md)。示例将客户授权及持久化留给应用实现。

计费：不冻结余额。上游实际计费的每个 Attempt 都按上游权威金额乘托管折扣收取，包括失败的 Attempt 和其后发生回退的 Attempt；上游未计费的 Attempt，以及 Yir 自身的交付失败和结果超时，不收费。`MaxCost` 封顶整个 Job 的总费用，并跳过估价超过它的路线。报价的主价格是估价，不是上限。报价后价格可能变化：较便宜的渠道可能下线或冷却，路由默认值可能改变可用渠道，目录价格也可能调整。把 `MaxCost` 当作在报价之上留有余量的失控兜底，而不是锁价；上限设得等于报价时，可能开始以 `YIR_BUDGET_EXCEEDED` 失败（提交时返回 422 并给出当前最低估价，或出现在 Job 上）。收到该错误时先重新报价，由应用决定是否在新请求中调高上限，不要自动调高。

新请求默认按渠道实际账单结算，无需选择计费模式。缺少可靠估价的渠道仍可能可用，但不能接受 `max_cost`；需要上限时请选择能够估价的渠道。未知价格不等于免费。

## 任务、文件与 Webhook

保存返回的任务 ID。`GetJob` 查询完整任务详情，`GetJobStatus` 查询轻量状态摘要 `JobStatusResponse`。`WaitJob` 默认长轮询状态摘要：`GetJobStatusWithWait` 让 Gateway 挂起查询直到状态变化（最长 30 秒），`WaitOptions.StatusWait` 默认 `DefaultStatusWait`（20 秒，自动收进 HTTP 客户端超时与 context 截止时间之内；负值关闭），无需 Webhook，Yir 记录终态后约 1 秒即可拿到。Gateway 未挂起直接返回时，回退到 `PollDelay` 退避（前 30 秒每 5 秒，约 90 秒内每 10 秒，之后每 20 秒）；设置 `WaitOptions.PollInterval` 可改为固定间隔。状态查询遇到 `429 YIR_RATE_LIMITED`（按 API Key 的每分钟请求上限）时按 `Retry-After`（`APIError.RetryAfter`，缺省 1 秒，最长 1 分钟）等待后继续，连续最多 5 次。进入终态后只读取一次完整 `Job`，若终态摘要与详情状态不符返回 `ErrJobStateInconsistent`。取消或超时 context 只停止本地等待，返回零值 `Job{}`，不取消远端任务或表示退款；用保存的 ID 恢复。`JobError` 包含失败或取消的终态任务；`APIError` 包含 HTTP status、code、message、retryable 和 action。业务判断使用稳定错误码。

`PollJob(ctx, id, wait)` 是给自行调度轮询的应用（持久化工作流或任务执行器）用的单步查询：查一次状态，终态时再读完整 `Job`，一致性检查相同。它自身不循环、不退避、不等限流（传输层对网络故障与 502/503/504 的有限重试仍然生效），失败或已取消的 Job 也不作为错误返回；仍在进行的 Job 只带 `ID`、`Status`、`Error` 和 `Cancellation`。

`CancelJob` 显式申请取消并返回 Job 的最新状态；对已经成功或失败的 Job，它返回这个已结束的 Job，而不是 Gateway 的 409 `YIR_JOB_NOT_CANCELLABLE`。应检查取消状态和终态账单，不假定立即成功或零费用。`Billing.TotalChargedMicros()` 以整数（百万分之一美元）返回总额。每个任务的 `Billing.TotalChargedByYir` 只结算一次，包括错误路径；`ComputeCharges`、`GatewayFee` 和 `OfficialComparison` 说明该总额的构成。`APIError.Code` 应与 `ErrCode*` 常量比较，而非字符串字面量。`APIError.RequestID` 是失败 HTTP 请求的 `request_id`，联系 Yir 支持时请一并提供。

`Job`、`JobStatusResponse`、`Quote`、`File` 和 `ModelDetail` 保留解码时的原始 JSON：`RawJSON()` 返回它，因此比 SDK 更新的字段（包括新的账单明细等嵌套字段）可以在 SDK 发版前用 `json.Unmarshal` 读取。代码中直接构造的值返回 `nil`；经过 `json.Marshal` 再解码的值返回重新编码后的内容。

媒体引用二选一：`FileID`（ready 的文件）或 `URL`（公开 HTTPS 地址，Yir 在提交时导入，最大 100 MiB，拒绝 data URL）。更大或不可公开访问的媒体使用文件上传。`CompleteFile` 可能返回 `processing`，`UploadFile` 默认最多等待五分钟到 `ready`。可用 `WaitForFileReady` 继续等待已保存的文件 ID；本地等待超时不会取消服务端分析。

`CreateFiles(ctx, request, key)` 创建上传计划；`UploadFile(ctx, plan, source)` 从 `io.ReaderAt` 上传并完成文件；`CreateAndUploadFile(ctx, metadata, source, key)` 合并步骤。保留稳定上传键及文件 ID。`GetFile` 查询状态，`CompleteFile` 完成手动上传。生成引用使用 ready 文件的 `FileID` 和适当角色，支持单段与分段上传计划。ready 的视频与音频文件带 `DurationSeconds`，即实测时长（向上取整到毫秒）。以 `FileID` 引用时，报价按该实测值计算参考视频等输入媒体费用；URL 引用在报价时没有实测时长，报价不给完整价格。

`GetFileContentURL(ctx, id)` 返回 ready 文件的短时签名 URL。SDK 从 307 响应的 `Location` 头读取该 URL，从不跟随跳转，因此 API Key 不会发给存储端。请求该 URL 时不要带 Gateway 凭据；过期后重新获取。只接受绝对 `https` URL，其余情况返回 `file_content_response_invalid`，错误中不含该 URL。文件不存在返回 `*APIError` 404 `YIR_FILE_NOT_FOUND`；尚未 ready 返回 409 `YIR_FILE_NOT_READY`（用 `WaitForFileReady` 等待后重试）；已过期返回 410 `YIR_FILE_EXPIRED`（需重新上传）。

`POST /v1/files` 重放已失败的上传时返回不可重试的 `400 YIR_INVALID_REQUEST`，需使用新的幂等键创建上传；已过期文件返回 `410 YIR_FILE_EXPIRED`，同样需新建上传及幂等键。瞬时错误（`retryable: true`）继续沿用原键，不要在规划进行中换键。

使用 `SubmitRequest.WebhookURL` 设置回调。`VerifyWebhookSignature` 接受 `Secret`、`ID`、`Timestamp`、`Signature` 和 `RawBody`。使用账户 Webhook secret，不是 API Key；传入 JSON 解析前的原始字节，并将回调签名元数据映射到这些字段。默认时钟容差为 300 秒。检查返回 error 和 `Valid`；按 Webhook ID 持久化去重，即使轮询同时观察到终态仍只结算一次。`ConstructWebhookEvent` 校验同样的字段，返回 Webhook ID 与终态 `Job`，失败时返回带稳定 `Reason` 的 `*WebhookVerificationError`。`Reason` 为 `unsupported_event` 表示签名有效，但请求体不是本 SDK 能识别的终态 Job（例如比 SDK 更新的事件类型）：返回 2xx 确认收到，记录日志，并按其 `ID` 去重。其他原因返回 4xx。无法在 `WaitJob` 中阻塞的持久化工作流可把 Webhook 当作唤醒信号，再用 `GetJob` 回读，并保留 `PollDelay` 轮询兜底。

## Demo 模式

Demo 模式用于不花钱地测试完整生成流程：把 `ClientOptions.Demo` 设为 `&yir.DemoOptions{}`（Go SDK 不读环境变量，请自行映射开关）。提交照常做本地校验，再调用对应的报价接口（不扣费），参数仍由网关校验，但请求不会真正提交。提交返回一个 ID 以 `demo_` 开头的 demo Job，带报价返回的模型和参数回显。报价、文件、余额和模型接口照常访问网关，因此仍需要 API Key。

Demo Job 不保存状态：ID 里编码了创建时间、类型、画幅、`n`、时长、分辨率和场景，所以 `GetJob`、`GetJobStatusWithWait`（挂起到下一次状态变化）和 `WaitJob` 在任何进程里得到同样结果，不发网络请求，并与 TypeScript SDK 一致。所有 `Client` 都在本地解答 `demo_` ID，关闭 demo 模式后也一样；用 `IsDemoJobID(id)` 区分。图片排队 2 秒、8 秒后成功，视频 25 秒，音频 12 秒。结果指向 `DemoAssetBaseURL`（`https://public.yir.ai/demo/v1/`）下带 DEMO 徽标的固定文件，按类型和最接近的画幅（视频再按 5 或 10 秒）选取；`Width`、`Height`、`DurationMS` 是实际文件的值，请求的值保留在 `Parameters` 中。扣费恒为 `"0"`。

`DemoOptions.Scenario` 或提示词中的 `[demo:<scenario>]` 标记（标记优先）决定结果：`DemoScenarioOK`（默认）；`DemoScenarioSlow`，排队 6 分钟、8 分钟后成功；`DemoScenarioFail`，以 `YIR_EXECUTION_FAILED` 失败且不扣费；`DemoScenarioReject`，报价后提交返回 `*APIError` 422 `YIR_INPUT_REJECTED`（包在 `*SubmissionError` 里）；`DemoScenarioCancel`，以 `cancelled` 结束。对未结束的 demo Job 调用 `CancelJob` 返回 `cancelled`，对已结束的返回该 Job 的终态；由于不保存状态，之后的读取仍按原时间线，请保留 `CancelJob` 返回的 Job。

提交返回报价的完整 `Parameters` 回显；之后按 ID 读取 demo Job 只保留 `n`、`aspect_ratio`、`resolution`、`duration` 四项（ID 装不下其余参数）。Demo 模式不覆盖：提交的幂等重放、余额/消费上限/`MaxCost` 准入错误、Webhook 投递、部分或过期结果、fallback 计费。

## 价格与合同

`GetModel(ctx, "creator/model")` 读取 Market `ModelDetail`：`Specifications` 及各渠道展示价格 `Channels`（未公布价格时 `AmountMicros` 为 `nil`），以及可选的 `ChannelParameters`。须传规范 ID，别名不能作为资源路径；非法 ID 在本地返回 `model_request_invalid`。SDK 忽略未知字段，并接受比 SDK 更新的操作、输入方式、币种、可用性取值和规则行为；但 ID 不一致或必填值缺失、为空时返回 `model_response_invalid`。模型不存在返回 `*APIError` 404 `YIR_MODEL_NOT_FOUND`。Market 价格仅供展示，提交前仍需报价。`GetModelContract` 仍用于读取带版本的参数合同（`view=contract`）。

通过 `ClientOptions.ModelContracts` 创建的客户端，只对该目录描述的模型、操作和输入方式校验参数与引用。其余请求（例如目录读取之后才上线的模型）只做协议检查，交由 Gateway 判断；需要对新模型做本地检查时，用 `GetModelContracts` 刷新目录。`ValidateGenerationWithCatalog` 仍然严格，目录外的模型返回 `model_contract_unavailable`；要把请求限定在该目录内，请自行调用它。

## 验证

在 `go/` 运行 `go test -p 2 ./...`，隔离验证时设置 `GOWORK=off` 和 `GOMAXPROCS=2`。无 `Output` 指令的示例仅编译、不执行。可选外部价格夹具缺失时跳过相关测试，不需要安装 Node。

结果完成与费用结清独立：`billing.status` 为 `pending` 时，当前金额仍可增加；为 `settled` 后才按 Job ID 完成一次费用对账。结果立即通知，延迟账单结清后另发 `job.billing_settled`；事件按事件 ID 去重，结果履约与费用入账分别按 Job ID 去重。也可继续查询 Job。旧服务缺少状态或未知状态时，不应依据 0 元推断结清。新请求省略 `billing_mode`；历史请求重试保留原始请求体与幂等键，包括原有字段。
