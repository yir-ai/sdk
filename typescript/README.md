# Yir TypeScript SDK

一个包，三个明确边界：

- @yir/sdk/server：createNodeYirClient 密钥客户端、createYirClient 自定义传输层、任务/文件和 Webhook。
- @yir/sdk/browser：显式导出模型合同、参数校验和纯价格计算。
- @yir/sdk/shared：共享类型和纯逻辑；不引用 server/browser。
- @yir/sdk/vercel：Vercel AI SDK 服务端适配。

server 和 browser 只依赖 shared；浏览器依赖图不得含 server 或 Node 内置模块。@yir/sdk 根入口为旧服务端入口保留兼容。pricing 和 model-contracts 子入口继续可用。API Key 不传浏览器；客户端浏览器保护不提供绕过开关。

验证：pnpm install --frozen-lockfile，pnpm check。生成合同：pnpm generate:model-contracts。示例位于 examples/；价格表只是计算输入，不授权生成或决定零售扣款。

当前 private:true，未发包。许可证和公开范围见根 README。

examples/quickstart.mjs 展示先报价、再保存请求与稳定幂等键、最后提交/恢复的顺序；需要调用方自己的持久化和预算授权。示例不会自动生成或收费。
