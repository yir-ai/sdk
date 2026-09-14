# 公开规范

[English](../../README.md) | 简体中文 · [仓库总览](README.md)

[openapi.json](../../openapi.json) 与 [models.json](../../models.json) 是从服务端同一版本一起导出的公开协议快照。模型目录的 `schema_ref` 指向 `./openapi.json#/components/schemas/ModelContractCatalog`，更新时保持引用与文件一致。

在 `typescript/` 执行 `pnpm generate:model-contracts` 生成随包分发的 TS/Go 合同，执行 `pnpm check:model-contracts` 检测漂移。生成器只消费公开快照，不访问私有服务端。保留模型已有双语元数据、稳定错误码和计费语义。

[fixtures/](../../fixtures/) 仅包含人工合同向量，不含实时价格或用户数据。Go 所需向量同时打包在 `go/testdata/`，下载模块后不依赖此目录即可测试。外部可选价格夹具保留已有跳过规则。

服务端负责从业务定义导出规范，本仓库负责依据公开定义生成 SDK、测试与发布；跨服务端验证留在私有仓库。静态规范不保证实时供给或最终扣费。运行时报价与恢复见 [Go](../../../go/docs/zh-CN/README.md) 和 [TypeScript](../../../typescript/docs/zh-CN/README.md) 指南。

中文翻译与英文文档成对维护，保留双向链接。中文仓库总览位于 `spec/docs/zh-CN/`，避免根目录堆文件；语言专属翻译位于各 SDK 的 `docs/zh-CN/`。

## 合同更新流程

1. 从同一个已审查服务端版本一起导出 `openapi.json` 和 `models.json`。源版本记录在私有交接中，此仓库仅接收公开快照，不得带入凭据、内部端点、生产价格或用户数据。
2. 生成前审查快照差异：请求与响应字段、必填项、模型操作、默认值、校验规则、稳定错误码及计费语义。更新快照不代表获准修改计费合同。
3. 在 `typescript/` 执行 `pnpm generate:model-contracts` 和 `pnpm check:model-contracts`。快照与生成的 TS/Go 文件一起提交，不手改生成文件。
4. 为行为变化补充聚焦回归测试或人工夹具，Go 所需向量保留在 `go/testdata/`。英文和中文指南、示例一起更新，在 PR 中说明应用迁移要求。
5. 在最终版本上运行 SDK 检查。服务端集成测试和付费生成分别处理；公开 CI 使用本地或模拟数据，不带 Yir 凭据。明确说明尚未验证的集成行为。
6. 各语言独立判断发版影响：纯文档变更无需发包；兼容修复通常升级补丁版本；`0.x` 阶段的不兼容 API 变更升级次版本并附迁移说明。不移动已发布标签或覆盖版本，发布需明确授权。

## 持续检查与发布验证

[SDK checks 工作流](../../../.github/workflows/ci.yml) 在 PR、`main` 推送和手动触发时运行，检查生成合同、TS 测试与类型、浏览器边界、实际归档安装，以及不含 `spec/` 的隔离 Go 模块。Node 产物留在 `typescript/`；Go 和测试并行度限制为 2，工作流超时为 15 分钟。

公开 PR 代码运行在 GitHub 一次性托管 runner 上，Token 只读，不持久化 checkout 凭据，不提供发布密钥。工作流不使用 `pull_request_target`，不访问私有服务。维护者须审查工作流及依赖变化，并保留 GitHub 外部贡献者审批要求。不要将承载基础服务的宿主直接连接到公开 PR 任务。

现有 `de-ci` runner 属于其他组织，本仓库不可使用。发布或其他较重验证，在 `de-ci` 的临时目录检出**已审查提交**后执行：

```sh
bash spec/scripts/verify-release.sh
```

脚本验证已提交的 HEAD，拒绝脏工作区，顺序运行限 2 核、4 GiB 的 Docker 容器，输出验证 SHA。Go 在不含仓库其他部分的模块目录中测试。退出时清理临时文件，不启动或重启服务。必要时按宿主已批准的直连下载方式预拉官方 Node/Go 镜像，不修改系统代理。不在该宿主执行未审查的 fork 或 PR 分支，只保留短期验证检出，不建立开发工作区。

将执行结果和 SHA 记录在 PR 或发布记录中。CI 通过不会自动发布；npm/Go 版本、标签和发布说明仍需分别授权。发布后验证匿名 registry 安装和版本身份。
