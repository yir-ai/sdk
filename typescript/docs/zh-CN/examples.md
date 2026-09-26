# TypeScript 示例

[English](../../examples/README.md) | 简体中文 · [TypeScript 指南](README.md)

先在 `typescript/` 执行 `pnpm build`。这些 ESM 文件导出辅助函数，加载时不自动调用生成 API。可导入自己的服务端或测试环境；示例不包含数据库或结账服务。

| 文件 | 用途 |
| --- | --- |
| [quickstart.mjs](../../examples/quickstart.mjs) | 图像报价，然后提交或恢复应用保存的请求 |

## 集成快速开始

1. 按[指南](README.md)创建服务端客户端。
2. 调用 `prepareImage(client, { model, prompt, parameters })`，仅报价，返回含已验证预算上限的 `{ request }`。
3. 后端审批客户预算，在持久化存储中按任务或订单 ID 保存 `{ request, idempotencyKey }`。审批或保存失败时不得提交。
4. 读取该记录并调用 `submitSavedImage(client, saved)`；等待前保存返回的任务 ID。
5. 超时且没有任务 ID 时，使用完全相同的请求和键重复第 4 步；已有 ID 时恢复轮询。账单只结算一次并复制可用文件。

第 3 步的持久化和审批是必须完成的应用集成，不是示例提供的函数。恢复不得重新报价或生成新身份。通过 API 获取报价，客户零售价格与购买授权由自己的后端负责。

构建后，在 `typescript/` 运行聚焦离线验证：

```sh
node --test --test-concurrency=2 tests/quickstart.test.mjs
```

Vercel 集成及限制见[指南](README.md#vercel-ai-sdk)和[模拟测试](https://github.com/yir-ai/sdk/blob/main/typescript/tests/vercel.test.mjs)。
