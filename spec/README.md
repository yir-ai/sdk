# 公共规范

openapi.json 和 models.json 是同一批公开协议快照；模型目录 schema_ref 指向 ./openapi.json#/components/schemas/ModelContractCatalog。更新时保持该引用与本目录文件名一致。

在 ../typescript/ 执行 pnpm generate:model-contracts，生成 TS/Go 随包制品；pnpm check:model-contracts 检测漂移。生成器不访问私有服务端。fixtures/ 只存人工合同向量，不放实时价格或用户数据；Go 下载用户所需向量随 go/testdata/ 打包。

服务端负责从业务定义导出公开规范，SDK 仓库负责基于公开规范生成、测试和发布；跨服务端验证仍在私有仓库进行。
