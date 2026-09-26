# SDK 代码审查台账

## 2026-09-26：外部参数合同与实时报价候选（独立复审通过，CI 待完成）

- 原审查方 AGY `review-mui8vouy-ab3f03ad` 复核 `2fe4aaef66570a9f1c7b8dcef536b1a107cff16e..19256626b350bf4e72755f5650c48e18be8b49b0`，结论 **Approve**，无新增可操作问题。`SDK-CONTRACT-20260926-01/02/03` 修复关闭；规范 ID 详情与批量错误码两项建议按服务端代码和回归测试驳回。独立定向 Go 测试通过（1.086s）。报告所称价差用例名称有笔误，实际新增用例为 `TestQuotePriceDifferenceMetadata`，包含在其 `TestQuote` 选择范围中。
- Pilio 使用该修复候选再次运行参数冻结/报价准备定向测试通过（0.476s）。依旧通过临时 workspace 消费，不代表正式依赖已锁定或 CI 已通过。

- 独立 AGY `review-mui89jh3-d44bad6e` 审查 `8552363dd1403d4a09b099a73c9c39598d6884de..2fe4aaef66570a9f1c7b8dcef536b1a107cff16e`，结论 Request Changes。`SDK-CONTRACT-20260926-01` / P1：Go 不支持 number 与小数边界；`-02` / P3：Go 搜索依赖硬编码；`-03` / P3：Go 未暴露报价价差。已实现修复，待原审查方复审；浮点用例修复前稳定复现失败，修复后 Go 定向测试通过（1.337s）。
- 两条意见按服务端合同保留现状：详情只接受规范模型 ID；批量单项参数错误固定为 `YIR_INVALID_REQUEST`，服务端失败走整体 HTTP 错误。复审须核对这些边界，不扩展未定义协议。工具所报六项文档漂移为主任务同时编辑，非已确认的审查方写入。
- 公开 OpenAPI 已同步当前参数合同与批量报价，移除旧价格表端点；历史 models.json 仅作为显式旧版参考。`pnpm check:model-contracts` 通过。CI 与正式消费版本仍待完成。

- 实现方 Codex；基准 `8552363dd1403d4a09b099a73c9c39598d6884de`。范围为 Go/TS 外部参数合同读取和校验、纯前端入口、客户目录生成器、20 项显式批量报价，以及旧价格表运行代码退出。公开包名、Go module、Job ID/状态校验、禁止浏览器使用密钥客户端、重定向保护、结果 warnings 保留。
- 实现方验证：TS 编译及类型测试通过；外部合同/批量报价/传输及 warnings 12 项通过；模型字段/引用/生成请求受影响测试已改为显式合同输入，后续报价/搜索/尾帧 8 项通过。`pnpm test:package` 实际打包、隔离安装和消费者运行/TypeScript 校验通过。Go `Test(Client|RemoteModelContract|ResultWarnings|Wait|GetJobStatus|SubmitUnknown|Quote|NanoSearchQuote|LastFrameContractAndTransport|ProSearchContractAndTransport)` 定向通过（1.155s）。不是全量或独立审查。
- 当前本地 Yir API 回读成功：50 个模型，合同版本 `42744c1abe2439319c58cac717c30b6e33e9c2667961c997d27a5b7de711c0c1`，已由纯前端解析器验证；没有生成任务或收费请求。Pilio 消费在隔离 worktree 验证，不写其主工作区。
- 未发布 npm 包或 Go tag，未部署生产。固定提交独立复审、CI、公开 spec 的旧价格表文本收敛及客户正式依赖锁定仍待完成；不能把此前发布的 0.1.0 当成本候选。

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
- 集成候选 `ce9be277b8baec34519508cd48033229a79da82d` 已无冲突合入主线 `c19c538d330c7c95f7d1e74a97e8f2e632a3e41e`；与已审查代码目标相比只有本台账，无运行时代码差异。复用代码审查，最终 PR 检查单独记录于 GitHub。
