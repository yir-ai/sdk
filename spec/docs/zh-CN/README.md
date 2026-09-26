# Yir SDK

[English](../../../README.md) | 简体中文

Yir 图像与视频 API 的官方 Go 和 TypeScript SDK。公开源码：[yir-ai/sdk](https://github.com/yir-ai/sdk)，采用 [MIT](../../../LICENSE) 许可证。

| 包 | 使用指南 | 范围 |
| --- | --- | --- |
| Go | [Go 指南](../../../go/docs/zh-CN/README.md) | 服务端客户端、报价、任务、文件和 Webhook |
| TypeScript | [TypeScript 指南](../../../typescript/docs/zh-CN/README.md) | 单个 `@yir-ai/sdk` 包，提供 server、browser、shared 入口和 Vercel AI SDK 适配 |
| 规范 | [公开合同](spec.md) | OpenAPI、模型合同、夹具与生成工具 |

## 安装

Go 1.25 及以上，在应用的模块目录执行：

```sh
go get github.com/yir-ai/sdk/go@v0.2.0
```

TypeScript 使用 `pnpm add @yir-ai/sdk@0.2.0` 安装。入口和本地归档安装方式见 [TypeScript 指南](../../../typescript/docs/zh-CN/README.md#安装)。

## 安全的生成流程

1. 构造明确的请求并取得报价，检查供给和可验证的单次尝试费用上限。
2. 由应用审批预算；提交前持久化包含 `max_cost` 的完整提交请求和稳定幂等键。
3. 提交已保存的请求。结果未知时使用同一请求与键恢复；取得任务 ID 后保存它，按 ID 恢复轮询。
4. 对终态账单只结算一次，并在结果 URL 过期前保存可用文件。

报价和静态价格表不会授权购买，也不保证实时供给或最终计费。客户零售价、账户授权、余额和持久化由应用负责。Yir Key 只保留在服务端；浏览器入口仅提供纯逻辑与类型。

完整流程见 [TypeScript 示例](../../../typescript/docs/zh-CN/examples.md) 和 [Go 示例指南](../../../go/docs/zh-CN/examples.md)。

## 开发

Node 命令只在 `typescript/` 中运行：

```sh
cd typescript
pnpm install --frozen-lockfile
pnpm check
```

在 `go/` 运行 `go test -p 2 ./...`；隔离验证时设置 `GOWORK=off` 和 `GOMAXPROCS=2`。Go 随模块包含必要测试夹具，不需要 Node 或根级 `spec/`。外部价格夹具缺失时，相关可选测试可能跳过。

根目录仅保留 `go/`、`typescript/`、`spec/`、README、LICENSE 和必要 Git 文件。Node 依赖、配置、锁文件和构建产物放在 `typescript/`。快照生成见[合同维护](spec.md)。Go 版本标签使用 `go/vX.Y.Z`，TypeScript 版本由其 `package.json` 管理；发布和打标签分别执行。
