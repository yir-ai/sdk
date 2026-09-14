# 公开规范

[English](../../README.md) | 简体中文 · [仓库总览](README.md)

[openapi.json](../../openapi.json) 与 [models.json](../../models.json) 是从服务端同一版本一起导出的公开协议快照。模型目录的 `schema_ref` 指向 `./openapi.json#/components/schemas/ModelContractCatalog`，更新时保持引用与文件一致。

在 `typescript/` 执行 `pnpm generate:model-contracts` 生成随包分发的 TS/Go 合同，执行 `pnpm check:model-contracts` 检测漂移。生成器只消费公开快照，不访问私有服务端。保留模型已有双语元数据、稳定错误码和计费语义。

[fixtures/](../../fixtures/) 仅包含人工合同向量，不含实时价格或用户数据。Go 所需向量同时打包在 `go/testdata/`，下载模块后不依赖此目录即可测试。外部可选价格夹具保留已有跳过规则。

服务端负责从业务定义导出规范，本仓库负责依据公开定义生成 SDK、测试与发布；跨服务端验证留在私有仓库。静态规范不保证实时供给或最终扣费。运行时报价与恢复见 [Go](../../../go/docs/zh-CN/README.md) 和 [TypeScript](../../../typescript/docs/zh-CN/README.md) 指南。

中文翻译与英文文档成对维护，保留双向链接。中文仓库总览位于 `spec/docs/zh-CN/`，避免根目录堆文件；语言专属翻译位于各 SDK 的 `docs/zh-CN/`。
