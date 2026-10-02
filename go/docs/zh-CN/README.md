# Yir Go SDK

> 0.2.0 protocol / 协议升级：模型参数来自 API，SDK 不再以内置模型清单限制请求；旧全量价格表与客户端计价已移除。升级前阅读 [migration guide](https://github.com/yir-ai/sdk/blob/main/typescript/docs/parameter-contracts.md)。

[English](../../README.md) | 简体中文 · [仓库总览](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/README.md) · [示例](examples.md)

服务端图像与视频 API 客户端。要求 Go 1.25+，模块为 `github.com/yir-ai/sdk/go`，采用 [MIT](../../LICENSE) 许可证。

## 安装

在应用的 Go 模块中执行：

```sh
go get github.com/yir-ai/sdk/go@v0.7.0
```

模块标签使用 `go/vX.Y.Z`，此版本对应 `go/v0.7.0`。模块包含必要测试向量，不需要 Node 或仓库的 `spec/`。

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

## 0.8.0 变化

0.8.0 为 minor 版本。调用签名不变，但以下行为有变化，请检查依赖这些行为的代码：

- 接受比 SDK 更新的 Job 与文件状态。只有 `succeeded`、`failed`、`cancelled` 表示 Job 结束，只有 `ready`、`failed`、`expired` 表示文件有结果；其余非空状态都视为进行中。提交、`GetJob`、`GetJobStatus`、`CancelJob` 与文件读取遇到新状态不再返回 `response_invalid`，`WaitJob` 会继续轮询，请用 context 限定等待时间。对 `Status` 的 `switch` 需要 default 分支。
- `WaitForFileReady`、`UploadFile` 与 `CreateAndUploadFile` 遇到 `processing` 及更新的状态会等待。此前 `CreateAndUploadFile` 遇到仍在 `processing` 的重放会返回 `file_not_ready`。
- `ConstructWebhookEvent` 收到签名有效、但不是终态 Job 的 JSON 对象（例如比 SDK 更新的事件类型）时，以 `Reason` `unsupported_event` 报告，并带上投递的 `ID` 与 `Timestamp`，不再是 `invalid_payload`。应返回 2xx 确认收到并记录日志。`invalid_payload` 现在只表示请求体不是 JSON 对象。
- 通过 `ClientOptions.ModelContracts` 创建的客户端只对目录描述的模型、操作和输入方式应用目录，其余交由 Gateway 判断，不再以 `model_contract_unavailable` 失败。要继续把请求限定在目录内，请调用仍然严格的 `ValidateGenerationWithCatalog`。
- 币种不是 USD 的报价返回 `ErrQuoteCurrencyUnsupported`（`quote_currency_unsupported`），不再是 `quote_response_invalid`；`Quote.Validate`、`QuoteImage`、`QuoteVideo` 与 `QuoteBatch` 均如此。此类报价仍会被拒绝。

兼容的新增：

- `GetModel` 接受比 SDK 更新的操作、输入方式、币种、可用性取值和规则行为。
- `Job`、`JobStatusResponse`、`Quote`、`File` 与 `ModelDetail` 新增 `RawJSON()`，返回解码时的原始 JSON，新字段可在 SDK 发版前读取。
- `APIError.RequestID` 是失败 HTTP 请求的 `request_id`。

## 0.7.0 变化

0.7.0 为 minor 版本，含不兼容变更：

- 新增显式 `BillingMode: "actual"`（见下文“报价与提交”）。
- `ComputeCharge` 只描述由 Yir 计费的托管供给：`Amount` 由 `*string` 改为 `string`，已退役的 BYOK 取值不再出现。读取 `Amount` 的代码需去掉解引用。

现有协议可以表达的模型、参数和价格变化，不再需要发布 SDK：

- `GetModelContracts` 与 `GetModelContract` 忽略比 SDK 更新的字段，接受新的操作、输入方式、参数类型与控件。SDK 不认识的规则键交由 Gateway 判断，已知规则含义不变、照常校验；新参数类型的取值不在本地检查。
- 未配置目录时使用的 `ValidateGenerationProtocol` 只检查协议骨架。提示词长度、引用来源与 `file_id` 格式、路由 provider 代码、偏好与上限由 Gateway 校验。`GenerationRequest.Extra` 用于发送比 SDK 更新的顶层字段，反序列化已保存的请求时会恢复。SDK 已建模的字段（`model`、`input`、`parameters`、`routing`、`billing_mode`、`max_cost`、`webhook_url`）放进 `Extra` 会以 `reserved_field` 拒绝，且不会从中发送。
- `Quote.Validate` 对金额、币种与价格大小关系仍严格校验，但接受新的价格类型（金额须为十进制或 nil）、供给问题、原因以及估算范围和用量指标。`QuoteBatch` 条目接受任意错误码。
- `ValidateGeneration` 与 `ValidateModelParameters` 已弃用：它们使用随包的历史目录。请改用 `ValidateGenerationWithCatalog` 并传入当前 `GetModelContracts` 数据。

## 0.4.0 变化

未设置 `WaitOptions.PollInterval` 时，`WaitJob` 改为按 `PollDelay` 退避（5 秒、10 秒、20 秒），不再每 2 秒轮询；需要固定间隔时设置 `PollInterval`。新增 `ConstructWebhookEvent`。调用签名不变。0.4.1 起 `ConstructWebhookEvent` 同样拒绝 `GetJob` 不接受的 Job ID，并明确 `PollDelay` 的 `poll` 为刚完成查询的 0 基序号。0.4.2 起 `Quote.Validate` 同样拒绝 `supply` 与价格矛盾的报价，与 TypeScript 校验一致。

## 0.3.0 迁移

**Go 0.3.0** 的生成方法最后一个键参数由 `string` 改为 `...string`，按模块 0.x 版本规则属于公共 API 不兼容变更。`client.SubmitImage(ctx, request, savedKey)` 等普通调用仍可编译，也可省略键；`SubmitVideo` 同样变化。

自定义接口应声明 `SubmitImage(context.Context, yir.SubmitRequest, ...string) (yir.Job, error)`，视频方法做对应修改。方法值不再匹配 `func(context.Context, yir.SubmitRequest, string) (yir.Job, error)`；需要保留原函数类型时可包装：

```go
submit := func(ctx context.Context, request yir.SubmitRequest, key string) (yir.Job, error) {
    return client.SubmitImage(ctx, request, key)
}
```

见[编译检查迁移示例](../../client_example_test.go)。

## 报价与提交

从 0.3.0 起，可直接调用 `SubmitImage(ctx, request)` 或 `SubmitVideo(ctx, request)`，SDK 每次调用生成随机幂等键。最后一个参数可传入一个非空且不含换行的显式键。Submit 不隐式重试；再次调用或跨进程恢复须复用已保存的键和完整请求。服务端同一 Job 内的故障转移不依赖客户端传键。

构造含 `Model`、`Input` 和明确 `Parameters` 的 `GenerationRequest`，使用 `QuoteImage` 或 `QuoteVideo`。保守的固定价流程要求 `Supply.Available`、`Primary.Kind == "fixed"`、`HasVerifiableUpperBound` 和非 nil 的 `SingleAttemptUpperBound`。审批新工作前检查过期时间。这是应用接受策略，API 仍支持其他报价类型。

应用审批预算后，持久化包含完整生成请求和 `MaxCost` 的 `SubmitRequest`，以及稳定幂等键；同时保存路由、引用和 `WebhookURL`。之后才调用 `SubmitImage(ctx, savedRequest, savedKey)` 或 `SubmitVideo`。报价不授权或触发生成。重试不得生成新键；传输结果未知时使用原请求与键恢复，不得悄悄用新报价或预算替换请求。

见[编译检查示例](../../client_example_test.go)和[集成指南](examples.md)。示例将客户授权及持久化留给应用实现。

0.7.0 新增显式 `BillingMode: "actual"`，要求 `Routing.Only`，不能同时提供 `MaxCost`。首批只支持 KIE/APIMart Kling 2.6/3.0 Motion Control 与 FAL FLUX 2 Pro 图片编辑。成功交付 winner 的权威实际费用没有保证上限；余额不足形成欠款，由后续手动充值抵还，欠款未清阻止新 Job。应用须保存客户授权、完整请求与幂等键，重试不得改变授权。省略模式及已有 Job 保持原合同。本功能要求 Gateway 支持实际成本计费。

## 任务、文件与 Webhook

保存返回的任务 ID。`GetJob` 查询完整任务详情，`GetJobStatus` 查询轻量状态摘要 `JobStatusResponse`。`WaitJob` 默认长轮询状态摘要：`GetJobStatusWithWait` 让 Gateway 挂起查询直到状态变化（最长 30 秒），`WaitOptions.StatusWait` 默认 `DefaultStatusWait`（20 秒，自动收进 HTTP 客户端超时与 context 截止时间之内；负值关闭），无需 Webhook，Yir 记录终态后约 1 秒即可拿到。Gateway 未挂起直接返回时，回退到 `PollDelay` 退避（前 30 秒每 5 秒，约 90 秒内每 10 秒，之后每 20 秒）；设置 `WaitOptions.PollInterval` 可改为固定间隔。进入终态后只读取一次完整 `Job`，若终态摘要与详情状态不符返回 `ErrJobStateInconsistent`。取消或超时 context 只停止本地等待，返回零值 `Job{}`，不取消远端任务或表示退款；用保存的 ID 恢复。`JobError` 包含失败或取消的终态任务；`APIError` 包含 HTTP status、code、message、retryable 和 action。业务判断使用稳定错误码。

`CancelJob` 显式申请取消，应检查取消状态和终态账单，不假定立即成功或零费用。每个任务的 `Billing.TotalChargedByYir` 只结算一次，包括错误路径；`ComputeCharges`、`GatewayFee`、`Savings` 和 `OfficialComparison` 说明该总额的构成。`APIError.Code` 应与 `ErrCode*` 常量比较，而非字符串字面量。`APIError.RequestID` 是失败 HTTP 请求的 `request_id`，联系 Yir 支持时请一并提供。

`Job`、`JobStatusResponse`、`Quote`、`File` 和 `ModelDetail` 保留解码时的原始 JSON：`RawJSON()` 返回它，因此比 SDK 更新的字段（包括新的账单明细等嵌套字段）可以在 SDK 发版前用 `json.Unmarshal` 读取。代码中直接构造的值返回 `nil`；经过 `json.Marshal` 再解码的值返回重新编码后的内容。

0.6.1 与 0.6.0 兼容。渠道价格缺少 `estimated` 或渠道参数缺少 `parameter_rules` 时，`GetModel` 返回 `model_response_invalid`，不再按 `false` 或空值读取。内置 `minimax/minimax-h3` 描述与服务端当前导出一致。

0.5.1 与 0.5.0 兼容。`Job` 新增 `FinalProvider`、`URLs`、`Usage`；`JobBilling` 新增 `ComputeCharges`、`GatewayFee`、`Savings`、`OfficialComparison`。新增 `ErrCode*` 常量与 `Version`，User-Agent 改为报告 SDK 版本。内置模型合同与服务端当前导出一致：新增 `alibaba/qwen-image-2.1`，Gemini Omni 接受 `duration`，`wan-2.6` 最多 5 个参考，移除 `kie/gemini-omni-video` 别名。仅显式使用内置合同的校验入口受影响；未传调用方目录的运行时请求不变。检查 `Result.Availability`，在 URL 过期前复制可用结果文件。

0.5.0 要求媒体引用使用 `FileID`，拒绝外部引用 URL。先上传原始字节；`CompleteFile` 可能返回 `processing`，`UploadFile` 默认最多等待五分钟到 `ready`。可用 `WaitForFileReady` 继续等待已保存的文件 ID；本地等待超时不会取消服务端分析。

`CreateFiles(ctx, request, key)` 创建上传计划；`UploadFile(ctx, plan, source)` 从 `io.ReaderAt` 上传并完成文件；`CreateAndUploadFile(ctx, metadata, source, key)` 合并步骤。保留稳定上传键及文件 ID。`GetFile` 查询状态，`CompleteFile` 完成手动上传。生成引用使用 ready 文件的 `FileID` 和适当角色，支持单段与分段上传计划。

0.6.0 起：`GetFileContentURL(ctx, id)` 返回 ready 文件的短时签名 URL。SDK 从 307 响应的 `Location` 头读取该 URL，从不跟随跳转，因此 API Key 不会发给存储端。请求该 URL 时不要带 Gateway 凭据；过期后重新获取。只接受绝对 `https` URL，其余情况返回 `file_content_response_invalid`，错误中不含该 URL。文件不存在返回 `*APIError` 404 `YIR_FILE_NOT_FOUND`；尚未 ready 返回 409 `YIR_FILE_NOT_READY`（用 `WaitForFileReady` 等待后重试）；已过期返回 410 `YIR_FILE_EXPIRED`（需重新上传）。

使用 `SubmitRequest.WebhookURL` 设置回调。`VerifyWebhookSignature` 接受 `Secret`、`ID`、`Timestamp`、`Signature` 和 `RawBody`。使用账户 Webhook secret，不是 API Key；传入 JSON 解析前的原始字节，并将回调签名元数据映射到这些字段。默认时钟容差为 300 秒。检查返回 error 和 `Valid`；按 Webhook ID 持久化去重，即使轮询同时观察到终态仍只结算一次。`ConstructWebhookEvent` 校验同样的字段，返回 Webhook ID 与终态 `Job`，失败时返回带稳定 `Reason` 的 `*WebhookVerificationError`。`Reason` 为 `unsupported_event` 表示签名有效，但请求体不是本 SDK 能识别的终态 Job（例如比 SDK 更新的事件类型）：返回 2xx 确认收到，记录日志，并按其 `ID` 去重。其他原因返回 4xx。无法在 `WaitJob` 中阻塞的持久化工作流可把 Webhook 当作唤醒信号，再用 `GetJob` 回读，并保留 `PollDelay` 轮询兜底。

## 价格与合同

0.6.0 起：`GetModel(ctx, "creator/model")` 读取 Market `ModelDetail`：`Specifications` 及各渠道展示价格 `Channels`（未公布价格时 `AmountMicros` 为 `nil`），以及可选的 `ChannelParameters`。须传规范 ID，别名不能作为资源路径；非法 ID 在本地返回 `model_request_invalid`。SDK 忽略未知字段，并接受比 SDK 更新的操作、输入方式、币种、可用性取值和规则行为；但 ID 不一致或必填值缺失、为空时返回 `model_response_invalid`。模型不存在返回 `*APIError` 404 `YIR_MODEL_NOT_FOUND`。Market 价格仅供展示，提交前仍需报价。`GetModelContract` 仍用于读取带版本的参数合同（`view=contract`）。

通过 `ClientOptions.ModelContracts` 创建的客户端，只对该目录描述的模型、操作和输入方式校验参数与引用。其余请求（例如目录读取之后才上线的模型）只做协议检查，交由 Gateway 判断；需要对新模型做本地检查时，用 `GetModelContracts` 刷新目录。`ValidateGenerationWithCatalog` 仍然严格，目录外的模型返回 `model_contract_unavailable`；要把请求限定在该目录内，请自行调用它。

## 0.2.0 合同更新

H3 reference 合同允许 1–15 项引用：图片最多 9 项、视频和音频各最多 3 项，可仅使用音频，保留 URL 与顺序。图生视频仍仅允许 adaptive。2026-09-16 已验证的 KIE 集成支持上述数量范围内的混合引用，但至少需要一项图片或视频；纯音频虽符合公共合同，仍不被该供应接受。每段视频或音频须为 2–15 秒，视频和音频各自总时长最多 15 秒。音视频须使用属于调用者、已完成可信测量且 ready 的 Files，以 `file_id` 引用；图片 URL 继续兼容。报价和准入使用可信测量，提交校验绑定的测量快照。其他渠道仍遵循各自支持的子集。完整请求必须取得有效报价；SDK 静态校验不代表在线可用或实际生成成功。此前 1–5 张图片的限制属于历史供应快照，不是当前 KIE 集成边界。

任务结果可包含 `result.warnings: ["additional_results_unavailable"]`，表示主要结果已交付，但可选附加结果未能交付。任务仍为 `succeeded`，`files` 仅含成功交付的文件；正常或历史响应可省略警告，结果过期后仍可保留历史警告。这不是生成失败，不授权自动重生成，不改变费用或 `parameter_notices`。

Seedance 2.0 支持可选布尔参数 `return_last_frame`（默认 false），其他模型拒绝该参数。请求尾帧需要覆盖完整费用的有效报价，不得套用普通视频价格；真实尾帧交付仍待验证。

Seedream 5.0 的文本和图片合同现接受 `4K`，图片输入最多允许 14 张参考图，其他参数不变。此合同更新不代表 4K 已在线可用，也不确认价格或精确输出尺寸；这些仍需服务端集成与报价确认。

当前工作版本在 Nano Banana 2 的文本和图片输入 `Parameters` 中接受可选布尔值 `web_search`、`image_search`，默认均为 false；图片搜索要求同时开启网页搜索。Nano Banana Pro 的文本和图片输入仅接受可选布尔值 `web_search`（默认 false），拒绝 `image_search`，包括显式 false；其余模型拒绝这两个字段。供应商搜索执行仍待实证，本次元数据更新不改变价格或开放供应。校验保留原请求，并执行按角色数量、必选角色组合、输出时长限制及重复引用检查。搜索可用性与费用需要支持该能力的供应和有效报价确认。这些更新尚未包含在已发布的 `v0.1.0` 模块中。

当前开发分支新增 `GetJobStatus`（`GET /v1/jobs/{id}/status`），并将 `WaitJob` 改造为两阶段轮询：先轮询轻量状态摘要 `JobStatusResponse`，进入终态（`succeeded`、`failed`、`cancelled`）后再读取一次完整 `Job`；终态状态不一致时返回 `ErrJobStateInconsistent`。`WaitOptions.OnPoll` 接收类型由完整 `Job` 改为 `JobStatusResponse` 摘要。等待中断（context 取消、超时）以及传输、校验或状态一致性错误时返回零值 `Job{}`，不伪造残缺任务；`JobError` 作为唯一例外返回完整的失败或已取消终态 `Job`。查询 status 遇到 404 错误时不静默回退到详情接口。已交付结果保留可选 `result.warnings`。上述状态轮询及零 Job 返回契约属于新特性，未包含在已发布的 `v0.1.0` 中；这些不兼容变化进入 0.2.0，升级时请按迁移说明调整调用方。

## 验证

在 `go/` 运行 `go test -p 2 ./...`，隔离验证时设置 `GOWORK=off` 和 `GOMAXPROCS=2`。无 `Output` 指令的示例仅编译、不执行。可选外部价格夹具缺失时跳过相关测试，不需要安装 Node。
