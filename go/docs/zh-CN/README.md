# Yir Go SDK

> 未发布协议升级 / Unreleased: models come from API catalogs; runtime clients no longer require a bundled model list. Exhaustive price tables and client pricing have been removed. See [migration guide](https://github.com/yir-ai/sdk/blob/main/typescript/docs/parameter-contracts.md). Existing package installation commands below refer to the previously published release.

[English](../../README.md) | 简体中文 · [仓库总览](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/README.md) · [示例](examples.md)

服务端图像与视频 API 客户端。要求 Go 1.25+，模块为 `github.com/yir-ai/sdk/go`，采用 [MIT](../../LICENSE) 许可证。

## 安装

在应用的 Go 模块中执行：

```sh
go get github.com/yir-ai/sdk/go@v0.1.0
```

模块标签使用 `go/vX.Y.Z`，此版本对应 `go/v0.1.0`。模块包含必要测试向量，不需要 Node 或仓库的 `spec/`。

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

## 报价与提交

构造含 `Model`、`Input` 和明确 `Parameters` 的 `GenerationRequest`，使用 `QuoteImage` 或 `QuoteVideo`。保守的固定价流程要求 `Supply.Available`、`Primary.Kind == "fixed"`、`HasVerifiableUpperBound` 和非 nil 的 `SingleAttemptUpperBound`。审批新工作前检查过期时间。这是应用接受策略，API 仍支持其他报价类型。

应用审批预算后，持久化包含完整生成请求和 `MaxCost` 的 `SubmitRequest`，以及稳定幂等键；同时保存路由、引用和 `WebhookURL`。之后才调用 `SubmitImage(ctx, savedRequest, savedKey)` 或 `SubmitVideo`。报价不授权或触发生成。重试不得生成新键；传输结果未知时使用原请求与键恢复，不得悄悄用新报价或预算替换请求。

见[编译检查示例](../../client_example_test.go)和[集成指南](examples.md)。示例将客户授权及持久化留给应用实现。

## 任务、文件与 Webhook

保存返回的任务 ID。`GetJob` 查询完整任务详情，`GetJobStatus` 查询轻量状态摘要 `JobStatusResponse`。`WaitJob` 默认每 2 秒轮询状态摘要，进入终态后只读取一次完整 `Job`，若终态摘要与详情状态不符返回 `ErrJobStateInconsistent`。取消或超时 context 只停止本地等待，返回零值 `Job{}`，不取消远端任务或表示退款；用保存的 ID 恢复。`JobError` 包含失败或取消的终态任务；`APIError` 包含 HTTP status、code、message、retryable 和 action。业务判断使用稳定错误码。

`CancelJob` 显式申请取消，应检查取消状态和终态账单，不假定立即成功或零费用。每个任务的 `Billing.TotalChargedByYir` 只结算一次，包括错误路径。检查 `Result.Availability`，在 URL 过期前复制可用结果文件。

`CreateFiles(ctx, request, key)` 创建上传计划；`UploadFile(ctx, plan, source)` 从 `io.ReaderAt` 上传并完成文件；`CreateAndUploadFile(ctx, metadata, source, key)` 合并步骤。保留稳定上传键及文件 ID。`GetFile` 查询状态，`CompleteFile` 完成手动上传。生成引用使用 ready 文件的 `FileID` 和适当角色，支持单段与分段上传计划。

使用 `SubmitRequest.WebhookURL` 设置回调。`VerifyWebhookSignature` 接受 `Secret`、`ID`、`Timestamp`、`Signature` 和 `RawBody`。使用账户 Webhook secret，不是 API Key；传入 JSON 解析前的原始字节，并将回调签名元数据映射到这些字段。默认时钟容差为 300 秒。检查返回 error 和 `Valid`；按 Webhook ID 持久化去重，即使轮询同时观察到终态仍只结算一次。

## 价格与合同


## 合同更新（尚未发布）

H3 reference 合同允许 1–15 项引用：图片最多 9 项、视频和音频各最多 3 项，可仅使用音频，保留 URL 与顺序。图生视频仍仅允许 adaptive。2026-09-16 已验证的 KIE 集成支持上述数量范围内的混合引用，但至少需要一项图片或视频；纯音频虽符合公共合同，仍不被该供应接受。每段视频或音频须为 2–15 秒，视频和音频各自总时长最多 15 秒。音视频须使用属于调用者、已完成可信测量且 ready 的 Files，以 `file_id` 引用；图片 URL 继续兼容。报价和准入使用可信测量，提交校验绑定的测量快照。其他渠道仍遵循各自支持的子集。完整请求必须取得有效报价；SDK 静态校验不代表在线可用或实际生成成功。此前 1–5 张图片的限制属于历史供应快照，不是当前 KIE 集成边界。

任务结果可包含 `result.warnings: ["additional_results_unavailable"]`，表示主要结果已交付，但可选附加结果未能交付。任务仍为 `succeeded`，`files` 仅含成功交付的文件；正常或历史响应可省略警告，结果过期后仍可保留历史警告。这不是生成失败，不授权自动重生成，不改变费用或 `parameter_notices`。

Seedance 2.0 支持可选布尔参数 `return_last_frame`（默认 false），其他模型拒绝该参数。请求尾帧需要覆盖完整费用的有效报价，不得套用普通视频价格；真实尾帧交付仍待验证。

Seedream 5.0 的文本和图片合同现接受 `4K`，图片输入最多允许 14 张参考图，其他参数不变。此合同更新不代表 4K 已在线可用，也不确认价格或精确输出尺寸；这些仍需服务端集成与报价确认。

当前工作版本在 Nano Banana 2 的文本和图片输入 `Parameters` 中接受可选布尔值 `web_search`、`image_search`，默认均为 false；图片搜索要求同时开启网页搜索。Nano Banana Pro 的文本和图片输入仅接受可选布尔值 `web_search`（默认 false），拒绝 `image_search`，包括显式 false；其余模型拒绝这两个字段。供应商搜索执行仍待实证，本次元数据更新不改变价格或开放供应。校验保留原请求，并执行按角色数量、必选角色组合、输出时长限制及重复引用检查。搜索可用性与费用需要支持该能力的供应和有效报价确认。这些更新尚未包含在已发布的 `v0.1.0` 模块中。

当前开发分支新增 `GetJobStatus`（`GET /v1/jobs/{id}/status`），并将 `WaitJob` 改造为两阶段轮询：先轮询轻量状态摘要 `JobStatusResponse`，进入终态（`succeeded`、`failed`、`cancelled`）后再读取一次完整 `Job`；终态状态不一致时返回 `ErrJobStateInconsistent`。`WaitOptions.OnPoll` 接收类型由完整 `Job` 改为 `JobStatusResponse` 摘要。等待中断（context 取消、超时）以及传输、校验或状态一致性错误时返回零值 `Job{}`，不伪造残缺任务；`JobError` 作为唯一例外返回完整的失败或已取消终态 `Job`。查询 status 遇到 404 错误时不静默回退到详情接口。已交付结果保留可选 `result.warnings`。上述状态轮询及零 Job 返回契约属于新特性，未包含在已发布的 `v0.1.0` 中；在 `0.x` 规范下，后续包含不兼容变更的正式发布需提升 minor 版本，本轮不修改发布版本号。

## 验证

在 `go/` 运行 `go test -p 2 ./...`，隔离验证时设置 `GOWORK=off` 和 `GOMAXPROCS=2`。无 `Output` 指令的示例仅编译、不执行。可选外部价格夹具缺失时跳过相关测试，不需要安装 Node。
