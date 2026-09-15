# Yir Go SDK

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

保存返回的任务 ID。`GetJob` 查询，`WaitJob` 默认每 2 秒轮询，可传入 `WaitOptions`。取消或超时 context 只停止本地等待，不取消远端任务或表示退款；用保存的 ID 恢复。`JobError` 包含失败或取消的终态任务；`APIError` 包含 HTTP status、code、message、retryable 和 action。业务判断使用稳定错误码。

`CancelJob` 显式申请取消，应检查取消状态和终态账单，不假定立即成功或零费用。每个任务的 `Billing.TotalChargedByYir` 只结算一次，包括错误路径。检查 `Result.Availability`，在 URL 过期前复制可用结果文件。

`CreateFiles(ctx, request, key)` 创建上传计划；`UploadFile(ctx, plan, source)` 从 `io.ReaderAt` 上传并完成文件；`CreateAndUploadFile(ctx, metadata, source, key)` 合并步骤。保留稳定上传键及文件 ID。`GetFile` 查询状态，`CompleteFile` 完成手动上传。生成引用使用 ready 文件的 `FileID` 和适当角色，支持单段与分段上传计划。

使用 `SubmitRequest.WebhookURL` 设置回调。`VerifyWebhookSignature` 接受 `Secret`、`ID`、`Timestamp`、`Signature` 和 `RawBody`。使用账户 Webhook secret，不是 API Key；传入 JSON 解析前的原始字节，并将回调签名元数据映射到这些字段。默认时钟容差为 300 秒。检查返回 error 和 `Valid`；按 Webhook ID 持久化去重，即使轮询同时观察到终态仍只结算一次。

## 价格与合同

`GetModelPrices` 获取经过校验的模型价格，缓存区分账户、策略、模型、操作、输入模式和过滤条件，遵守过期时间。本地价格辅助函数只消费表，不发送请求。保留十进制字符串和表的 scale；估算、冻结金额和静态模型元数据不是最终账单或实时供给保证。缺少价格行不表示免费或不支持输入。客户零售价、余额和授权与 Yir 采购成本分离。见[价格示例](../../pricing_example_test.go)和[公开合同](https://github.com/yir-ai/sdk/blob/main/spec/docs/zh-CN/spec.md)。

## 合同更新（尚未发布）

任务结果可包含 `result.warnings: ["additional_results_unavailable"]`，表示主要结果已交付，但可选附加结果未能交付。任务仍为 `succeeded`，`files` 仅含成功交付的文件；正常或历史响应可省略警告，结果过期后仍可保留历史警告。这不是生成失败，不授权自动重生成，不改变费用或 `parameter_notices`。

Seedance 2.0 支持可选布尔参数 `return_last_frame`（默认 false），其他模型拒绝该参数。请求尾帧需要覆盖完整费用的有效报价，不得套用普通视频价格；真实尾帧交付仍待验证。

Seedream 5.0 的文本和图片合同现接受 `4K`，图片输入最多允许 14 张参考图，其他参数不变。此合同更新不代表 4K 已在线可用，也不确认价格或精确输出尺寸；这些仍需服务端集成与报价确认。

当前工作版本在 Nano Banana 2 的文本和图片输入 `Parameters` 中接受可选布尔值 `web_search`、`image_search`，默认均为 false；图片搜索要求同时开启网页搜索。Nano Banana Pro 的文本和图片输入仅接受可选布尔值 `web_search`（默认 false），拒绝 `image_search`，包括显式 false；其余模型拒绝这两个字段。供应商搜索执行仍待实证，本次元数据更新不改变价格或开放供应。校验保留原请求，并执行按角色数量、必选角色组合、输出时长限制及重复引用检查。搜索可用性与费用需要支持该能力的供应和有效报价确认。这些更新尚未包含在已发布的 `v0.1.0` 模块中。

## 验证

在 `go/` 运行 `go test -p 2 ./...`，隔离验证时设置 `GOWORK=off` 和 `GOMAXPROCS=2`。无 `Output` 指令的示例仅编译、不执行。可选外部价格夹具缺失时跳过相关测试，不需要安装 Node。
