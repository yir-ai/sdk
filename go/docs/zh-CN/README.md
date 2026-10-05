# Yir Go SDK

> 内测阶段（0.x）。不兼容变更只随 minor 版本发布，迁移说明写在 README 与[变更记录](CHANGELOG.md)中。比 SDK 新的字段和取值按数据读取，新增模型与选项无需升级 SDK。

[English](../../README.md) | 简体中文 · [仓库总览](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/README.md) · [示例](examples.md)

服务端图像与视频 API 客户端。要求 Go 1.25+，模块为 `github.com/yir-ai/sdk/go`，采用 [MIT](../../LICENSE) 许可证。

## 安装

在应用的 Go 模块中执行：

```sh
go get github.com/yir-ai/sdk/go@v0.11.1
```

模块标签使用 `go/vX.Y.Z`，此版本对应 `go/v0.11.1`。模块包含必要测试向量，不需要 Node 或仓库的 `spec/`。

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

密钥保留在服务端。默认地址是 `https://gateway.yir.ai`，按需配置 `ClientOptions.BaseURL` 和 `ClientOptions.HTTPClient`。默认 HTTP 超时为 30 秒，拒绝重定向。

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

见[编译检查示例](../../client_example_test.go)和[集成指南](examples.md)。示例将客户授权及持久化留给应用实现。

计费：不冻结余额。上游实际计费的每个 Attempt 都按上游权威金额乘托管折扣收取，包括失败的 Attempt 和其后发生回退的 Attempt；上游未计费的 Attempt，以及 Yir 自身的交付失败和结果超时，不收费。`MaxCost` 封顶整个 Job 的总费用，并跳过估价超过它的路线。报价的主价格是估价，不是上限。显式 `BillingMode: "actual"`（仅支持 KIE/APIMart Kling 2.6/3.0 Motion Control 与 FAL FLUX 2 Pro 图片编辑）要求 `Routing.Only`，不能同时设置 `MaxCost`，且没有上限；余额不足的部分形成欠款，由后续手动充值偿还，欠款未清阻止新 Job。应用须将客户授权与完整请求、幂等键一起持久化。

## 任务、文件与 Webhook

保存返回的任务 ID。`GetJob` 查询完整任务详情，`GetJobStatus` 查询轻量状态摘要 `JobStatusResponse`。`WaitJob` 默认长轮询状态摘要：`GetJobStatusWithWait` 让 Gateway 挂起查询直到状态变化（最长 30 秒），`WaitOptions.StatusWait` 默认 `DefaultStatusWait`（20 秒，自动收进 HTTP 客户端超时与 context 截止时间之内；负值关闭），无需 Webhook，Yir 记录终态后约 1 秒即可拿到。Gateway 未挂起直接返回时，回退到 `PollDelay` 退避（前 30 秒每 5 秒，约 90 秒内每 10 秒，之后每 20 秒）；设置 `WaitOptions.PollInterval` 可改为固定间隔。进入终态后只读取一次完整 `Job`，若终态摘要与详情状态不符返回 `ErrJobStateInconsistent`。取消或超时 context 只停止本地等待，返回零值 `Job{}`，不取消远端任务或表示退款；用保存的 ID 恢复。`JobError` 包含失败或取消的终态任务；`APIError` 包含 HTTP status、code、message、retryable 和 action。业务判断使用稳定错误码。

`CancelJob` 显式申请取消，应检查取消状态和终态账单，不假定立即成功或零费用。每个任务的 `Billing.TotalChargedByYir` 只结算一次，包括错误路径；`ComputeCharges`、`GatewayFee` 和 `OfficialComparison` 说明该总额的构成。`APIError.Code` 应与 `ErrCode*` 常量比较，而非字符串字面量。`APIError.RequestID` 是失败 HTTP 请求的 `request_id`，联系 Yir 支持时请一并提供。

`Job`、`JobStatusResponse`、`Quote`、`File` 和 `ModelDetail` 保留解码时的原始 JSON：`RawJSON()` 返回它，因此比 SDK 更新的字段（包括新的账单明细等嵌套字段）可以在 SDK 发版前用 `json.Unmarshal` 读取。代码中直接构造的值返回 `nil`；经过 `json.Marshal` 再解码的值返回重新编码后的内容。

媒体引用二选一：`FileID`（ready 的文件）或 `URL`（公开 HTTPS 地址，Yir 在提交时导入，最大 100 MiB，拒绝 data URL）。更大或不可公开访问的媒体使用文件上传。`CompleteFile` 可能返回 `processing`，`UploadFile` 默认最多等待五分钟到 `ready`。可用 `WaitForFileReady` 继续等待已保存的文件 ID；本地等待超时不会取消服务端分析。

`CreateFiles(ctx, request, key)` 创建上传计划；`UploadFile(ctx, plan, source)` 从 `io.ReaderAt` 上传并完成文件；`CreateAndUploadFile(ctx, metadata, source, key)` 合并步骤。保留稳定上传键及文件 ID。`GetFile` 查询状态，`CompleteFile` 完成手动上传。生成引用使用 ready 文件的 `FileID` 和适当角色，支持单段与分段上传计划。

`GetFileContentURL(ctx, id)` 返回 ready 文件的短时签名 URL。SDK 从 307 响应的 `Location` 头读取该 URL，从不跟随跳转，因此 API Key 不会发给存储端。请求该 URL 时不要带 Gateway 凭据；过期后重新获取。只接受绝对 `https` URL，其余情况返回 `file_content_response_invalid`，错误中不含该 URL。文件不存在返回 `*APIError` 404 `YIR_FILE_NOT_FOUND`；尚未 ready 返回 409 `YIR_FILE_NOT_READY`（用 `WaitForFileReady` 等待后重试）；已过期返回 410 `YIR_FILE_EXPIRED`（需重新上传）。

使用 `SubmitRequest.WebhookURL` 设置回调。`VerifyWebhookSignature` 接受 `Secret`、`ID`、`Timestamp`、`Signature` 和 `RawBody`。使用账户 Webhook secret，不是 API Key；传入 JSON 解析前的原始字节，并将回调签名元数据映射到这些字段。默认时钟容差为 300 秒。检查返回 error 和 `Valid`；按 Webhook ID 持久化去重，即使轮询同时观察到终态仍只结算一次。`ConstructWebhookEvent` 校验同样的字段，返回 Webhook ID 与终态 `Job`，失败时返回带稳定 `Reason` 的 `*WebhookVerificationError`。`Reason` 为 `unsupported_event` 表示签名有效，但请求体不是本 SDK 能识别的终态 Job（例如比 SDK 更新的事件类型）：返回 2xx 确认收到，记录日志，并按其 `ID` 去重。其他原因返回 4xx。无法在 `WaitJob` 中阻塞的持久化工作流可把 Webhook 当作唤醒信号，再用 `GetJob` 回读，并保留 `PollDelay` 轮询兜底。

## 价格与合同

`GetModel(ctx, "creator/model")` 读取 Market `ModelDetail`：`Specifications` 及各渠道展示价格 `Channels`（未公布价格时 `AmountMicros` 为 `nil`），以及可选的 `ChannelParameters`。须传规范 ID，别名不能作为资源路径；非法 ID 在本地返回 `model_request_invalid`。SDK 忽略未知字段，并接受比 SDK 更新的操作、输入方式、币种、可用性取值和规则行为；但 ID 不一致或必填值缺失、为空时返回 `model_response_invalid`。模型不存在返回 `*APIError` 404 `YIR_MODEL_NOT_FOUND`。Market 价格仅供展示，提交前仍需报价。`GetModelContract` 仍用于读取带版本的参数合同（`view=contract`）。

通过 `ClientOptions.ModelContracts` 创建的客户端，只对该目录描述的模型、操作和输入方式校验参数与引用。其余请求（例如目录读取之后才上线的模型）只做协议检查，交由 Gateway 判断；需要对新模型做本地检查时，用 `GetModelContracts` 刷新目录。`ValidateGenerationWithCatalog` 仍然严格，目录外的模型返回 `model_contract_unavailable`；要把请求限定在该目录内，请自行调用它。

## 验证

在 `go/` 运行 `go test -p 2 ./...`，隔离验证时设置 `GOWORK=off` 和 `GOMAXPROCS=2`。无 `Output` 指令的示例仅编译、不执行。可选外部价格夹具缺失时跳过相关测试，不需要安装 Node。
