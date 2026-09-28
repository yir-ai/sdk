# SDK 代码审查台账

## 2026-09-28 幂等键发布候选：独立审查与完整 CI 通过

- 用户已有合并授权。最终候选 `dcdca33e5b9147f35f66576dfda54a1352855e65` 的 [CI 36406408521](https://github.com/yir-ai/sdk/actions/runs/36406408521) completed/success；台账增量由原审查方 `review-mul2mqcd-721d9ebb` 复审 **Approve / 无问题**。SDK [PR #6](https://github.com/yir-ai/sdk/pull/6) 于 `2026-09-28T09:56:36Z` 合并为 `376603d750701b82c39e27b70303a07d8623e5dd`；其 tree 与已审最终候选完全一致，合并后 [CI 36406662638](https://github.com/yir-ai/sdk/actions/runs/36406662638) completed/success。TypeScript 0.2.1 与 Go 0.3.0 仍为未发布候选，无新增标签或实际发包。

- 独立审查方 AGY `review-mul2b72z-39c490bd` 只读审查固定范围 `31026cce9530c92fb429ebf54191fdebcdcaeaa2..ecf9b4df56c41cf665692b8414c5b1e6ce1a76b0` 全部增量，结论 **Approve / 无问题**。覆盖各语言版本、迁移合同、归档消费者、类型及双语正式安装边界；旧接口失败与新接口/包装函数编译、实际 TS 归档安装（5.97s）由审查方独立复核。
- 同一候选 [PR #6](https://github.com/yir-ai/sdk/pull/6) 完整 [SDK checks 36405566814](https://github.com/yir-ai/sdk/actions/runs/36405566814) completed/success（53s）：合同、TS 全测试/类型/归档安装、独立 Go 模块通过。本条仅登记已取得证据，运行实现及候选内容不变；未发包、打标签或部署。

## 2026-09-28 幂等键发布候选：实现方定向验证

- 实现者 Codex，基准 `31026cce9530c92fb429ebf54191fdebcdcaeaa2`。保留已合并的默认生成键实现，仅准备 TypeScript `0.2.1` 元数据、Go `0.3.0` 候选与双语迁移说明，并增强实际归档消费者验证。
- Go 普通带键调用保持可用，但 `string` 改为 `...string` 不兼容固定签名接口与方法函数赋值；采用各语言独立版本，按 0.x 规则提升 Go minor。正式安装命令仍固定已发布 `0.2.0`，未创建标签或发布包。
- `pnpm run test:package` 通过（5.6s）：从实际 `0.2.1` 归档安装后验证省略键、每次调用不同键、同键同请求恢复及未知 Submit 只发送一次；消费者类型检查覆盖图片和视频可选键调用。`GOWORK=off GOMAXPROCS=2 go test -p 2 -run '^ExampleClient_SubmitImage_legacyFunction$' ./...` 通过（0.901s），只编译迁移示例，不执行生成。`git diff --check` 通过。
- 本条为实现方定向验证；固定提交独立审查及完整 CI 待完成，历史实现审查按既有范围复用。

## 2026-09-28 默认生成幂等键：PR #5 合并

- 用户明确授权推进合并。最终候选 `143082f9ad4d81dbd1b95b9a179a45105b49a62f` 的 [SDK checks 36395971800](https://github.com/yir-ai/sdk/actions/runs/36395971800) completed/success（42s）；运行代码与上述两轮独立 AGY 审查覆盖的实现一致，后续仅记录审查证据。
- [PR #5](https://github.com/yir-ai/sdk/pull/5) 于 `2026-09-28T08:38:49Z` 普通合并，GitHub 回读 MERGED，合并提交 `dcdccc01e2ab0a504cdd144c95003ee9757d8c47`。本地干净工作区已快进至该主线。本条仅登记最终结果，未发布包、打标签或部署生产。
- 原独立审查方 AGY `review-mul05wca-b157563e` 复核合并记录增量 `dcdccc01e2ab0a504cdd144c95003ee9757d8c47..1ee7d9337097a11eef43b4b6eab1e6374164544d`：**Approve**，无新增可操作问题；通过 GitHub 核实合并 SHA、时间和最终候选 CI，运行代码无变化。本条仅追加该审查事实。

## 2026-09-28 默认生成幂等键：固定提交审查与 CI 通过

- 收尾记录增量 `597c528d0420eb0214bf50059a7887248b1d2a72..99286c9aac1e38b32e883754bd31d00cfd61aa17` 经原独立审查方 `review-mukyvkbt-aea350b3` 复核 **Approve**、无可操作问题，运行代码未变化；本条仅追加该结论。

- 独立 AGY `review-mukyh7kc-60444f08` 只读审查 `7f168cd91a9e247859caebfeb763eb997254d89d..597c528d0420eb0214bf50059a7887248b1d2a72` 全部 15 文件，结论 **Approve**、无可操作问题。覆盖正确性、仓库约定、协议与安全边界；未调用真实供应商，未做生产联调，不推进更早历史的连续审查状态。
- 分支 `codex/generation-idempotency` 已推送，候选 [PR #5](https://github.com/yir-ai/sdk/pull/5)。同一 `597c528d0420eb0214bf50059a7887248b1d2a72` 的完整 [SDK checks 36394772538](https://github.com/yir-ai/sdk/actions/runs/36394772538) completed/success（44s）：合同生成、全 TS 测试/类型、归档与安装、独立 Go 模块验证。本条仅追加证据，运行代码不变。仍未发包、打标签或合并 PR。

## 2026-09-28 生成幂等键可选与默认生成：实现自验

- 用户授权实现并收尾提交、清理、推送；实现者 Codex。基准 `7f168cd91a9e247859caebfeb763eb997254d89d`，分支 `codex/generation-idempotency`；14 文件源码/文档补丁 SHA256 `468a8c89a7829ce0224ae52195576417ce4c7dd68442ef99f37c175aeb9bac22`，本记录另计。范围为 TS/Go 生成客户端、AI SDK 适配层、OpenAPI、聚焦回归及中英文使用指南。
- 参数省略时每次调用自动生成随机键，显式键校验并复用；AI SDK 同次上传和 Submit 使用同一生成键派生身份。REST 仍可省略，服务端 Job 内 fallback 独立于该 Header。SDK 保留无隐式 Submit 重试合同；跨调用/进程恢复由调用方持久化原键和原请求。
- 自验：TS 两份配置编译通过；键语义、未知结果和内联素材 6 个行为用例通过（0.427s）；另运行 `node --test --test-concurrency=2 tests/transport.test.mjs`，2 PASS（0.197s）。Go `-run '^(TestClientSubmitOptionalIdempotencyKey|TestClientQuoteAndSubmitShareDemand|TestClient.*(Retry|Redirect|Unknown).*|TestSubmitUnknownOutcomeIsNotRetried)$' -count=1 -p 2` 通过（0.818s），`GOWORK=off GOMAXPROCS=2` 及 Yir 共享固定缓存。`pnpm check:model-contracts`、`gofmt -d` 与 `git diff --check` 通过。
- 本节是实现方自验，固定提交独立审查及完整 CI 待完成；未改发布版本、未打 tag、未发布包或调用真实付费生成。已发布 0.2.0 仍要求传键，新增文档明确该行为尚未发布。

## 2026-09-26：PR #4 完整 CI 与适配器修复

- 首轮 CI `36238176016` 在 `502d7180a1ae7bd0c12759b6bfea4a3b794c76df` 发现四项失败。`SDK-CONTRACT-20260926-06` / P2：AI SDK 适配器预校验未传递显式 modelContracts；`-07` / P3：浏览器边界测试仍要求已删除的 calculatePrice。修复 `0d298f3c2638e699f8408a7bea72b758bd8badb4` 补传可选合同并更新显式测试夹具/导出断言，相关 18 项测试通过。
- 独立 AGY `review-muian8hx-4bbeba14` 审查 `502d7180a1ae7bd0c12759b6bfea4a3b794c76df..0d298f3c2638e699f8408a7bea72b758bd8badb4`，Approve、无新增问题，独立 18 项测试通过（609.8ms），两项关闭。
- 同一修复 SHA 的完整 GitHub Actions [36238275792](https://github.com/yir-ai/sdk/actions/runs/36238275792) 成功（44s）：合同生成、全部 TS 测试、类型检查、归档安装、独立 Go 模块测试全部通过。候选 PR 为 [#4](https://github.com/yir-ai/sdk/pull/4)。建议下一版 0.2.0，迁移说明见 PR；尚未合并、发包或打标签，客户正式依赖锁定仍待发布。

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
