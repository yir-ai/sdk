# Yir SDK

单仓库维护多语言 SDK；各语言独立安装、测试和版本。公开源码仓库：https://github.com/yir-ai/sdk 。采用 MIT 许可证；尚未发布 npm 包。

- **go/**：Go 服务端 SDK，模块 github.com/yir-ai/sdk/go。
- **typescript/**：一个 @yir/sdk 包；server 负责密钥客户端和 Webhook，browser 提供浏览器安全能力，shared 复用纯逻辑和类型。
- **spec/**：跨语言公共规范、模型合同、测试向量与生成器；不包含服务端实现。

## TypeScript

在 typescript/ 运行 pnpm install --frozen-lockfile，然后 pnpm check。Node 配置、依赖与临时产物只放在该子目录，不在根目录安装。

```ts
import { createNodeYirClient } from '@yir/sdk/server';
import { calculatePrice, getModelContract } from '@yir/sdk/browser';
import type { Job } from '@yir/sdk/shared';
import { createYirAIProvider } from '@yir/sdk/vercel';
```

createYirClient(transport) 保留显式传输层合同；createNodeYirClient({apiKey}) 提供服务端 HTTP 客户端。浏览器不得持有 Yir Key，密钥客户端在浏览器中拒绝运行。原根入口及 pricing、model-contracts 子入口保留兼容，新代码优先显式 server/browser 入口。

## Go

在 go/ 运行 go test -p 2 ./...。Go SDK 随模块包含必要测试向量；不要求 Node 或整个仓库可用。

## 合同维护

Yir 私有仓库从同一提交导出公开 OpenAPI 和模型合同到 spec/openapi.json、spec/models.json；在 typescript/ 执行 pnpm generate:model-contracts 和 pnpm check:model-contracts。生成器只消费公开快照，不访问私有服务端。公开规范和 SDK 静态参数不保证实时供给或最终计费。

Go 子模块版本使用 go/vX.Y.Z；TS 使用 package.json 版本，独立发布。npm 包名与发布单独管理；Pilio 正式依赖暂不切换。

GitHub 仓库公开与 npm 发包分别进行；npm 包目前保留 private:true，避免误发布。
