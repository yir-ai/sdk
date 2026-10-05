# TypeScript SDK 变更记录

0.10.0 之前的版本说明，从 README 移来。各条按发布当时的行为记录，可能已被后续版本取代；当前行为见 [README](README.md)。

## 0.9.0 变化

0.9.0 为 minor 版本，含不兼容变更，移除 Gateway 已不再使用的接口：

- `Quote` 删除 `max`、`single_attempt_upper_bound`、`has_verifiable_upper_bound` 与 `supply.requires_max_cost`。Gateway 仍为旧版 SDK 返回这些常量（`max` 重复 `primary`，其余为 `null` 或 `false`），本 SDK 忽略它们。估价读 `primary`，预算由应用自行设置 `max_cost`。
- 删除 `Job.billing.savings`，Gateway 自 2026-10-02 起不再返回；改用 `billing.official_comparison`。
- 删除 `checkParameterPolicies`、`ModelParameterContract.policy` 以及报价/提交时的控制台提醒。模型合同不再携带 policy；实际参数处理由报价和 Job 的 `parameter_notices` 报告。
- `RoutingPreference` 不再列出 `balanced`。Gateway 仍把它当作 `cost` 的别名接受，请改传 `cost`。
- 删除 `DEFAULT_POLL_INTERVAL_MS`；需要固定间隔时设置 `pollIntervalMs`。
- `examples/quickstart.mjs` 改为由第三个参数传入已批准的 `max_cost`，不再从已删除的上限字段推导。

## 0.8.0 变化

0.8.0 为 minor 版本，与 0.7.0 兼容。

- `Job.result.content_safety`（类型 `JobResultContentSafety`）说明交付的结果是否通过 NSFW 检测、由谁检测：上游渠道对该路线执行审核时为 `{ status: "passed", checked_by: "provider" }`，Yir 自行检测时为 `{ status: "passed", checked_by: "yir" }`，无法检测时为 `{ status: "unchecked" }`。该字段上线前交付的结果没有此字段。为 `passed` 时可以跳过你自己的 NSFW 检测，否则按你自己的策略处理。Yir 自己的输出检测只拦露骨成人内容。未通过检测的输出不会交付，Job 以 `YIR_CONTENT_REJECTED` 失败；上游已生成并计费，因此按上游费用收费。
- `RoutingPreference` 新增 `speed`，按观测到的上游耗时升序排列渠道，样本不足的渠道排在其后并按价格排序。默认仍为 `cost`；`balanced` 标为已弃用，是 `cost` 的别名，Gateway 仍接受。该值仍由 Gateway 校验，旧版 SDK 也可向支持的 Gateway 发送 `speed`。

## 0.7.0 变化

0.7.0 为 minor 版本，含不兼容变更：

- `JobStatus` 与 `InputFile.status` 以 `(string & {})` 放宽。只有 `succeeded`、`failed`、`cancelled` 表示 Job 结束，只有 `ready`、`failed`、`expired` 表示文件有结果；其余非空状态都视为进行中。`getJob`、`getJobStatus`、`cancelJob` 与文件读取接受新状态，`waitForJob` 与 `uploadFile` 会继续等待，Vercel 适配器将其报告为 `pending`。穷举的 `switch` 需要 default 分支。
- 错误响应体没有错误码时，code 为 `http_error`，不再是 `HTTP_<status>`，与 Go SDK 一致；HTTP 状态仍见 `YirAPIError.status`。`YirAPIError` 构造函数的默认值相同。
- Node 传输默认将每个 Gateway 请求限制为 30 秒（`DEFAULT_REQUEST_TIMEOUT_MS`），超时以 `TimeoutError` 拒绝。较慢的调用请设置 `timeoutMs`，设为 `0` 则不限制。提交超时时，用同一请求和幂等键恢复。
- `submitImage` 与 `submitVideo` 收到的响应不是 ID 和状态都有效的 Job 时，以 `response_invalid` 拒绝。
- `constructWebhookEvent` 收到签名有效、但不是终态 Job 的 JSON 对象（例如比 SDK 更新的事件类型）时，以 `reason` `unsupported_event` 报告，并带上投递的 `id` 与 `timestamp`，不再是 `invalid_payload`。应返回 2xx 确认收到并记录日志。`invalid_payload` 现在只表示请求体不是 JSON 对象。
- 传入目录创建的客户端及 Vercel 适配器只对目录描述的模型、操作和输入方式应用目录，其余交由 Gateway 判断，不再以 `model_contract_unavailable` 失败。`validateGeneration(operation, request, catalog)` 与请求构造器仍然严格。
- 币种不是 USD 的报价以 `quote_currency_unsupported` 拒绝，不再是 `quote_response_invalid`；`quoteBatch` 同样如此。此类报价仍会被拒绝。

兼容的新增：`action` 使用开放联合类型 `YirErrorAction`；错误响应体没有标准错误对象时也保留 `YirAPIError.requestId`。`waitForJob`（以及 Vercel 适配器的图片等待）默认长轮询：每次状态查询请 Gateway 挂起最多 20 秒（`statusWaitSeconds`，设为 `0` 关闭）直到状态变化，Yir 记录终态后约 1 秒即可拿到；挂起时长收进等待超时之内，Gateway 未挂起时回退到 `pollDelayMs`。新增 `getJobStatus(id, { waitSeconds })` 与传输请求字段 `holdMs`，自带请求时限的自定义传输应按 `holdMs` 延长时限。

## 0.6.0 变化

0.6.0 为 minor 版本，含不兼容变更：

- 新增显式 `billing_mode: "actual"`（见上文）。
- `ComputeCharge` 只描述由 Yir 计费的托管供给：`supply_type`、`billed_by`、`amount_basis` 收窄为 `managed`、`yir`、`yir_price_rule`，`amount` 不再为 `null`，`status` 不再含 `external`。

现有协议可以表达的模型、参数和价格变化，不再需要发布 SDK：

- 模型目录与模型详情保留比 SDK 更新的字段和枚举值（新控件、参数类型、操作、输入方式、可用性或规则行为）。SDK 不认识的规则键交由 Gateway 判断，已知规则含义不变、照常校验；新参数类型的取值不在本地检查。不再抛出 `model_contract_semantics_unsupported`。
- 未传入目录时，请求校验只检查协议骨架：对象结构、非空 `model`、`input.type`、提示词与引用角色、`max_cost`、`billing_mode`、HTTPS `webhook_url` 及路由取值类型。提示词长度、引用角色与来源、`file_id` 格式、路由 provider 代码、偏好与上限由 Gateway 校验。顶层、`input`、引用和 `routing` 中的未知字段原样透传，不再以 `unknown_field` 失败。
- 报价金额、币种与价格大小关系仍严格校验，但接受新的价格 `kind`（金额须为十进制或 null）、供给问题、原因以及估算范围和用量指标。批量报价条目接受任意错误码。
- 类型以 `(string & {})` 放宽，已知取值仍可补全；`Quote.parameters` 允许额外键，`QuotePrice` 增加开放变体。穷举 `switch` 需补默认分支。
- Vercel 适配器把 `seed` 与视频 `fps` 映射为同名 Yir 参数，是否接受由模型合同决定。

## 0.5.1

0.5.1 与 0.5.0 兼容。内置 `minimax/minimax-h3` 描述与服务端当前导出一致，API 无变化。

## 0.5.0 迁移

0.5.0 为 `YirClient` 新增 `getModel`，为 `YirFileClient` 新增 `getFileContentURL`。自行实现这两个类型的代码需补上这些方法；通过 `createYirClient` 或 `createNodeYirClient` 创建客户端的调用方无需改动。`YirTransportRequest` 新增可选字段 `redirect: "manual"`。忽略该字段的自定义传输对其他调用不受影响，但 `getFileContentURL` 会失败（抛出传输自身的跳转错误或 `file_content_response_invalid`），不会返回 URL。

## 0.4.1

0.4.1 与 0.4.0 兼容。`cancelJob(id, options)` 支持中断信号，返回的不是所请求任务时抛出 `response_invalid`。`Quote.parameters` 新增 `return_last_frame`、`web_search`、`image_search`。新增 `YIR_ERROR_CODES` 与 `YirErrorCode`，`DEFAULT_USER_AGENT` 报告包版本。内置模型合同与服务端当前导出一致：新增 `alibaba/qwen-image-2.1`，Gemini Omni 接受 `duration`，`wan-2.6` 最多 5 个参考，移除 `kie/gemini-omni-video` 别名。仅使用内置目录的校验受影响。

## 0.3.0 变化

未设置 `pollIntervalMs` 时，`waitForJob`（以及 Vercel 适配器的图片等待）改为按 `pollDelayMs` 退避（5 秒、10 秒、20 秒），不再每 2 秒轮询；需要固定间隔时设置 `pollIntervalMs`。`DEFAULT_POLL_INTERVAL_MS` 已弃用。新增 `constructWebhookEvent` 与 `YirWebhookVerificationError`。调用签名不变。0.3.1 起 `constructWebhookEvent` 同样拒绝 `getJob` 不接受的 Job ID，并明确 `pollDelayMs` 的 `poll` 为刚完成查询的 0 基序号。0.3.2 起请求构造器按 Unicode 码点计算 20,000 字符的提示词上限，含 emoji 的提示词不再被提前拒绝。

## 0.2.0 合同更新

H3 reference 合同允许 1–15 项引用：图片最多 9 项、视频和音频各最多 3 项，可仅使用音频，保留 URL 与顺序。图生视频仍仅允许 adaptive。2026-09-16 已验证的 KIE 集成支持上述数量范围内的混合引用，但至少需要一项图片或视频；纯音频虽符合公共合同，仍不被该供应接受。每段视频或音频须为 2–15 秒，视频和音频各自总时长最多 15 秒。音视频须使用属于调用者、已完成可信测量且 ready 的 Files，以 `file_id` 引用；图片 URL 继续兼容。报价和准入使用可信测量，提交校验绑定的测量快照。其他渠道仍遵循各自支持的子集。完整请求必须取得有效报价；SDK 静态校验不代表在线可用或实际生成成功。此前 1–5 张图片的限制属于历史供应快照，不是当前 KIE 集成边界。

任务结果可包含 `result.warnings: ["additional_results_unavailable"]`，表示主要结果已交付，但可选附加结果未能交付。任务仍为 `succeeded`，`files` 仅含成功交付的文件；正常或历史响应可省略警告，结果过期后仍可保留历史警告。这不是生成失败，不授权自动重生成，不改变费用或 `parameter_notices`。

Seedance 2.0 支持可选布尔参数 `return_last_frame`（默认 false），其他模型拒绝该参数。请求尾帧需要覆盖完整费用的有效报价，不得套用普通视频价格；真实尾帧交付仍待验证。

Seedream 5.0 的文本和图片合同现接受 `4K`，图片输入最多允许 14 张参考图，其他参数不变。此合同更新不代表 4K 已在线可用，也不确认价格或精确输出尺寸；这些仍需服务端集成与报价确认。

当前工作版本为 Nano Banana 2 的文本和图片输入增加可选的 `parameters.web_search`、`parameters.image_search`，默认均为 false；`image_search: true` 要求 `web_search: true`。Nano Banana Pro 的文本和图片输入仅接受可选布尔值 `web_search`（默认 false），拒绝 `image_search`，包括显式 false；其余模型拒绝这两个字段。供应商搜索执行仍待实证，本次元数据更新不改变价格或开放供应。校验保留调用者的参数。搜索需要明确支持该能力的供应和有效报价，静态支持不代表当前可用或免费。本更新尚未包含在已发布的 `0.1.0` 包中。

当前开发分支新增 `getJobStatus`（`GET /v1/jobs/{id}/status`），并将 `waitForJob` 改造为两阶段轮询：先轮询轻量状态摘要 `JobStatusResponse`，进入终态（`succeeded`、`failed`、`cancelled`）后再读取一次完整 `Job`；终态状态不一致时抛出 `job_state_inconsistent` 错误。`WaitForJobOptions.onPoll` 接收类型由完整 `Job` 改为 `JobStatusResponse` 摘要，`YirTimeoutError.lastJob` 迁移为 `lastStatus`。等待异常（包括 abort、超时与传输异常）不伪造残缺任务。查询 status 遇到 404 错误时不静默回退到详情接口。已交付结果保留可选 `result.warnings`。上述状态轮询及错误结构属于新契约，未包含在已发布的 `0.1.0` 中；这些不兼容变化进入 0.2.0，升级时请按迁移说明调整调用方。

显式提供参数合同时，引用校验执行其中的角色数量、必选角色组合和输出时长限制，并拒绝重复引用。模型专属语义依赖由网关校验。报价、保存授权与提交之间应保留完整请求。
