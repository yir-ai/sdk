# SDK 代码审查台账

## 2026-09-20：Job 轻量状态轮询

- 执行：agy；审查与验证：Codex。会话 `224fcb3b-9431-4689-a3bf-92349dedeca0` 已确认 IDLE，无继续写入。
- 最终基准：`9614601ff5881c40a1e07d97f619118f65314849`；最后已审查提交：`53509783e5409985c0ba5e78ea45190a6adbea97`。
- 覆盖：该提交全部 18 个文件的增量及相关等待、HTTP 校验、类型导出、结果警告行为；未审查基准以前的全部模型变更。
- 原开发基准为 `dff260b9928bfc7c975c8aec84b31f7b7a34e80c`，初始提交 `ef4c8beb4b954618801a737478fd5e19179f8f51`。本次分支移至已存在的远程基准，排除 dff260b 的独立模型改动；原分支与备份分支仍保留。两次 Job 增量的 stable patch-id 均为 `ce541a3d97f940dba25fad0a497932572b02034c`。最终基线上重新验证，不拼接旧基线结果。
- 结论：本次增量审查通过。等待使用 status 摘要，终态读取完整详情；终态不一致报错。404 不静默回退；等待中断不取消、不重新提交 Job。保留结果 warnings 与原有模型说明。onPoll、TS lastStatus、Go 非 JobError 返回零 Job 的不兼容变化已有中英迁移说明；未修改发布版本。

### 问题及处理

| 编号 | 发现位置与影响 | 处理与复审 |
| --- | --- | --- |
| SDK-JS-20260920-01 | 原基准上的工作区：旧 convenience/result-warnings 测试未适配新摘要路径，首轮 Go 1 项、TS 9 项失败 | 保留原断言并拆分摘要/详情响应，最终提交已复审；最终相关测试通过 |
| SDK-JS-20260920-02 | 原基准工作区：Go 新超时测试依赖恰好第三次轮询的时间窗口，存在竞态 | 改为显式 phase 控制，最终提交已复审；Go 根包通过 |
| SDK-JS-20260920-03 | 原基准工作区：Go 文档误删既有搜索段，且错误返回说明未区分 JobError | 恢复原段并准确描述完整终态 Job 与零值返回，最终提交已复审 |

### 最终候选实际验证

- `go test -p 2 . -count=1`（Go 根包，GOWORK=off、GOMAXPROCS=2、共享缓存）：通过，1.015s。不是 `go test ./...` 或完整 Linux CI。
- TypeScript 6 个相关文件：standard-client、convenience-client、transport、result-warnings、package-exports、vercel，共 57 项通过。
- `pnpm exec tsc -p tsconfig.type-tests.json --noEmit`、`pnpm check:model-contracts`：通过。
- `pnpm test:package`：通过；编译并实际安装本地 tgz，验证运行时导出和消费端类型，不发布。
- OpenAPI 仅增加 status 路径及 JobStatusResponse，已与 API 真源逐项核对；未同步其他模型合同。`git diff --check` 通过。
- Pilio 候选通过临时 go.work 引用此提交的 SDK：`go test -p 2 ./app/yirjob -count=1` 通过，0.346s。该验证不代表远程依赖已可获取。
- 用户在明确的开发分支推送与 CI 授权问题后回复“继续”。已推送 `codex/job-status-polling`，远程回读为 `53509783e5409985c0ba5e78ea45190a6adbea97`。
- [SDK CI 35520352604](https://github.com/yir-ai/sdk/actions/runs/35520352604) 已成功，精确 head 为上述提交；包含完整 TypeScript 合同/测试/类型/归档安装及独立 Go 模块测试。使用公共 SDK 已有 GitHub-hosted 工作流，无共享 de-ci PR 执行。
- Pilio 已能正常下载 `v0.1.1-0.20260920145605-53509783e540`；关闭 go.work 且 `-mod=readonly` 的 yirjob 包测试通过（0.383s），模块回读无 Replace。
- 未合并 main、未打标签、未发布 npm 包、未运行生产请求或部署。
- 用户现已明确授权收尾、整理、提交和合并；本台账随本批提交，合并以最终 PR 检查为准，不包含版本发布或部署。
