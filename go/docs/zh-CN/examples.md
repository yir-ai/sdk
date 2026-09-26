# Go 示例

[English](../../examples/README.md) | 简体中文 · [Go 指南](README.md)

[client_example_test.go](../../client_example_test.go) 是经编译检查的生命周期示意：创建客户端、图像报价、要求可验证的固定价预算，然后提交并等待。它不是独立命令。集成 Submit 前，必须在自己的任务记录中实现客户预算审批，持久化完整 `SubmitRequest` 和稳定键。恢复读取同一记录，不替换请求或键；取得任务 ID 后保存并按 ID 恢复轮询。

示例没有 `Output` 指令，`go test` 仅编译，不执行 API 请求。复制到应用并调用它可能提交付费任务，须先实现审批和持久化。超时不证明失败或退款。包括 `JobError` 路径在内，终态账单只结算一次，并在过期前复制文件。

使用 `GetModelContracts` 获取参数合同，以 `QuoteImage`、`QuoteVideo` 或 `QuoteBatch` 获取报价。本地价格表计算已移除；客户零售定价由应用自行负责。

在 `go/` 执行聚焦验证，设置 `GOWORK=off` 和 `GOMAXPROCS=2`：

```sh
go test -p 2 -run Example ./...
```

此命令编译全部包示例，只运行声明预期输出的示例，不运行 API 生命周期示意。
