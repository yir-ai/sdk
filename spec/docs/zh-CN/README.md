# Yir SDK

[English](../../../README.md) | 简体中文

> 内测阶段（0.x）。不兼容变更只随 minor 版本发布，迁移说明写在各 SDK 的 README 与变更记录中。

Yir 图像与视频 API 的官方 Go 和 TypeScript SDK。公开源码：[yir-ai/sdk](https://github.com/yir-ai/sdk)，采用 [MIT](../../../LICENSE) 许可证。

| 包 | 使用指南 | 范围 |
| --- | --- | --- |
| Go | [Go 指南](../../../go/docs/zh-CN/README.md) | 服务端客户端、报价、任务、文件和 Webhook |
| TypeScript | [TypeScript 指南](../../../typescript/docs/zh-CN/README.md) | 单个 `@yir-ai/sdk` 包，提供 server、browser、shared 入口和 Vercel AI SDK 适配 |
| 规范 | [公开合同](spec.md) | OpenAPI、模型合同、夹具与生成工具 |

## 安装

Go 1.25 及以上，在应用的模块目录执行：

```sh
go get github.com/yir-ai/sdk/go@v0.11.0
```

TypeScript 使用 `pnpm add @yir-ai/sdk@0.10.0` 安装。入口和本地归档安装方式见 [TypeScript 指南](../../../typescript/docs/zh-CN/README.md#安装)。

## 兼容性

SDK 固定协议，API 提供模型。模型、参数、允许值和默认值都来自 `GET /v1/models?include=parameters`，新增模型、新选项或修正限制都不需要发布 SDK。可在运行时获取目录，或在构建时据此生成 `models.ts`；两个 SDK 都不内置目录。

- API 只做加法：新字段都是可选的，枚举可能新增取值，SDK 把未知字段和取值当作数据读取。
- 已发布模型的默认值、取值含义和计费语义不变；任何一项变化都以新模型 ID 发布，因此省略参数的请求含义和价格不会变。
- ID 是不透明字符串，不要解析。
- 只有新增操作或新请求结构才需要发布 SDK。不兼容的 SDK 变更只在 `0.x` 的 minor 版本发布，并附迁移说明。

## 安全的生成流程

生成幂等键可省略，省略时 SDK 每次调用自动生成一个随机键。Submit 只发送一次；再次调用或跨进程恢复必须复用调用方已保存的键和完整请求。服务端同一 Job 内的故障转移不依赖该 Header。

1. 构造明确的请求并取得报价，检查供给；主价格是估价，不是上限。
2. 由应用审批支出；提交前持久化完整提交请求（含可选的 `max_cost`）和稳定幂等键。
3. 提交已保存的请求。结果未知时使用同一请求与键恢复；取得任务 ID 后保存它，按 ID 恢复轮询。
4. 对终态账单只结算一次，并在结果 URL 过期前保存可用文件。

报价和静态价格表不会授权购买，也不保证实时供给或最终计费。客户零售价、账户授权、余额和持久化由应用负责。Yir Key 只保留在服务端；浏览器入口仅提供纯逻辑与类型。

上游实际计费的每个 Attempt 都按上游权威金额乘托管折扣收取，包括失败的 Attempt 和其后发生回退的 Attempt；上游未计费的 Attempt，以及 Yir 自身的交付失败和结果超时，不收费。`max_cost` 封顶整个 Job 的总费用。报价后价格可能变化：较便宜的渠道可能下线或冷却，路由默认值可能改变可用渠道，目录价格也可能调整。把 `max_cost` 当作在报价之上留有余量的失控兜底，而不是锁价；上限设得等于报价时，可能开始以 `YIR_BUDGET_EXCEEDED` 失败（提交时返回 422 并给出当前最低估价，或出现在 Job 上）。收到该错误时先重新报价，由应用决定是否在新请求中调高上限，不要自动调高。显式 `billing_mode: "actual"`（Go 为 `BillingMode: "actual"`）要求 `routing.only`，不能同时设置 `max_cost`，仅支持 KIE/APIMart Kling 2.6/3.0 Motion Control 与 FAL FLUX 2 Pro 图片编辑；它没有上限，余额不足形成钱包欠款，由后续手动充值偿还，欠款未清阻止新 Job。应用须将客户授权与完整请求、幂等键一起持久化。

`routing.preference` 决定候选渠道顺序：`cost`（默认）按价格升序；`speed` 按观测到的上游耗时升序，样本不足的渠道排在其后并按价格排序。SDK 原样透传该值，由 Gateway 校验。

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
