# Go SDK 变更记录

各版本说明，新版本在前。各条按发布当时的行为记录，可能已被后续版本取代；当前行为见 [README](README.md)。

## 0.15.0 变化（2026-11-13）

此 minor 版本包含 demo 取消行为的不兼容变化；真实任务取消行为不变。

- **迁移：** 未结束的 demo Job 调用 `CancelJob` 现在返回 ErrDemoCancelUnsupported (`demo_cancel_unsupported`)，不再假装取消成功。改用 `cancel` 场景联调取消终态；已结束的任务仍返回原终态。
- Demo 不再因模型名超过 40 字符而拒绝提交；旧 ID 仍兼容。Demo ID 可超过 64 字符，存储时不要截断；真实 Job ID 的校验不变。
- 文档明确免费联调边界：仍需 Key 和网络，不验证真实执行资格，不模拟幂等重放、主动取消、Webhook 或结算。
- 新增图片 `layer_decomposition` 输入和结果 `layer` 元数据类型，支持 Seedream 5.5 图层拆解。
- URL 参考媒体可在报价时声明 `duration_seconds`；报价 `input_duration_source: "declared"` 表示使用声明时长，实际任务仍按测量时长计费。
- 同步公开模型合同快照；快照不保证实时供给。

## 升级到 0.14.0

0.14.0 是包含不兼容行为变化的 minor 版本，变化见下。所依赖的网关能力均已上线。

兼容新增：

- `SubmissionNotAccepted(err)` 判断一次提交的错误是否足以证明没有创建 Job、幂等键也没有被占用：SDK 在发送前拒绝的请求，或带 Yir 错误码的 4xx 拒绝（408、`YIR_IDEMPOTENCY_CONFLICT` 与 `YIR_JOB_NOT_FOUND` 除外）。释放自己的预留或给用户退款前先用它判断。
- `PollJob(ctx, id, wait)` 供自行调度轮询的应用查询一次：先读轻量状态，只有终态才读完整 Job，一致性检查与 `WaitJob` 相同。
- `JobBilling.TotalChargedMicros()` 与 `USDMicros(amount)` 把 API 金额转成整数（百万分之一美元）。

行为变化：

- 带键的生成提交在请求发出后以结果不明的方式失败（网络错误、响应中断、502/503/504、取消或其他读取失败）时，返回包在 `*SubmissionError` 里的 `*SubmissionUncertainError`，不再直接返回最后一次的错误。它有意不向下 Unwrap：`errors.As(err, &apiErr)` 与 `errors.Is` 不再能取到最后一次的 `*APIError`、网络或 context 错误，需要时读 `Err`。判断“未受理”之前先检查它，并用其 `IdempotencyKey` 重新提交。
- 对已经成功或失败的 Job 调用 `CancelJob`，现在返回这个已结束的 Job，不再返回 `409 YIR_JOB_NOT_CANCELLABLE` 的 `*APIError`。原先遇到 409 再读一次 Job 的分支可以删掉；把“无错误”当作“已取消”的代码必须读 `Status`（取消只是已申请时本来也需要这样做）。

## 升级到 0.13.0

0.13.0 是 minor 版本，与 0.12.0 兼容。所依赖的网关能力均已上线。

新增：

- Demo 模式：`ClientOptions.Demo`（`DemoOptions`、`DemoScenario*`）、`IsDemoJobID` 与 `DemoAssetBaseURL`。所有 `Client` 都在本地解答 `demo_` Job ID。见 [Demo 模式](README.md#demo-模式)。
- `/v1/audio` 接口的 `QuoteAudio` / `SubmitAudio`（音乐、音效与语音合成；`QuoteMusic` / `SubmitMusic` 保留为别名）、`voice` 参数，以及 `generate_sound_effect` / `generate_speech` 报价与 `QuoteBatch` 项。
- 有序中间帧的参考角色 `keyframe`；模型合同与 `ValidateGenerationWithCatalog` 支持混合主体、主体声音和视频主体。
- 参数说明的 disposition 新增 `exceeded`，表示结果超出请求。

## 升级到 0.12.0

0.12.0 是包含不兼容行为变化的 minor 版本，导出 API 只有新增。0.11.2 未单独发布，其[变化](#0112-变化)随本版本一并发布。所依赖的 Gateway 功能均已上线。

不兼容变化：

- 报价与提交不再按 `ClientOptions.ModelContracts` 校验模型参数，只校验协议骨架，交给 Gateway 校验。参数非法时返回带 `ErrCodeInvalidRequest` 的 `*APIError`（字段见 `Details`），不再是本地的 `*ParameterError`。需要本地严格校验时调用 `ValidateGenerationWithCatalog`。
- 提交失败返回 `*SubmissionError`，携带 `IdempotencyKey` 并包装传输或 API 错误。用 `errors.As` 取得 `*APIError`；直接对返回错误做类型断言将不再匹配。
- `HTTPClient.Timeout`（默认 30 秒）限制整次调用，包括下文的传输重试。
- 旧的 `BillingMode: "actual"` 请求不再要求 `Routing.Only`。

新增：

- 读取请求和带幂等键的生成提交遇到网络错误或 HTTP 502/503/504 时，最多重试三次，保持原请求体与幂等键；遵守不超过一分钟的 `Retry-After`。`WaitJob` 在 Gateway 短暂不可用时继续等待已受理的 Job，并等待 `429 YIR_RATE_LIMITED`（`APIError.RetryAfter`）过去。
- `QuoteAudio`、`SubmitAudio`（旧名 `QuoteMusic` / `SubmitMusic`）、`GenerationInput.Lyrics` 与 `ResultFile.DurationMS`，见[报价与提交](README.md#报价与提交)。
- `ClientOptions.ReferralCode`，作为 `Yir-Referral` 发送。
- `client.GetBalance`，以及用于 Account API 的 `NewAccountClient`，含路由配置的 `ExcludedModelProviders`。
- `Routing.Fidelity`（`RoutingFidelity*`、`ErrCodeFidelityExcluded`）、`Routing.Accelerate`，以及每个结果文件的 `ResultFile.Fidelity`。
- `APIError.ProviderError`、`ErrCodeInputRejected` 与 `JobBilling.Status`（`pending` 或 `settled`）。
- 模型合同新增 `StringValues`（如 Seedance 2.5 时长 `"auto"`，报价与 Job 参数回显中保留）和 `PromptOptional`；没有在售渠道的市场规格予以保留。

## 0.11.2 变化

0.11.2 为兼容版本：

- 新增可选的 `Quote.ExpectedAmount`（`*string`）：首选渠道的准入估价，Yir 核对余额、API Key 月度上限和 `max_cost` 都用它。与只估输出的 `estimate` 类价格不同，它包含参考图等已知输入费用，按用量计费的渠道还参考近期实收。没有匹配渠道或缺少可靠估价时不返回。`Validate` 要求它是十进制数，且没有供应时不得出现。作为成本参考时优先用它而不是 `Primary.Amount`；它不是上限。

## 0.11.1 变化

0.11.1 为兼容版本，跟进网关的参数回显与目录缓存变化：

- `Quote.Parameters` 只回显模型合同声明的参数，按合同写法，省略的参数补默认值：图片报价和没有该参数的视频模型不再出现 `duration`、`generate_audio`。模型专属参数按合同名回显。
- `Job.Parameters`（`map[string]any`）自创建起携带同样的回显，应用可据此核对交付结果与扣费参数。
- 模型合同参数的 `Required` 现在表示“没有默认值、请求必须传”；带 `Default` 的参数一律 `Required: false`，可以省略。`ValidateGenerationWithCatalog` 本来就先补默认值再检查 `Required`，本地校验行为不变。
- `GET /v1/models` 与 `view=contract` 响应带 `ETag`（即加引号的目录 `version`）和 `Cache-Control: private, max-age=300`，并对 `If-None-Match` 回 304。`GetModelContracts` 暂不发条件请求，自定义 `HTTPClient` 可以。

## 升级到 0.11.0

0.11.0 为 minor 版本，含不兼容变更，为 1.0 合同做准备。从 0.9 升级请先看 [0.10.0 说明](#0100-变化)；0.10.0 未单独发布，随本版本一起发布。

- 移除内置模型目录：包级 `ListModelContracts`、`GetModelContract`、`GetModelOperationContract`、`ValidateGeneration` 与 `ValidateModelParameters` 已删除。用 `client.GetModelContracts` 获取目录，再传给 `ValidateGenerationWithCatalog` 或 `ClientOptions.ModelContracts`。新增模型和参数调整都不需要发布 SDK。
- Job ID 是不透明字符串。任何非空、不超过 64 个字符、可安全作为一段 URL 路径的 ID 都会被接受；按字符串保存，不要解析。
- 未配置目录时，报价可能把你传入的别名回显为 `creator/model` 形式的规范 ID，其他不同的模型会校验失败；配置目录时按解析后的 ID 比对。
- `APIError.Details`（`[]ErrorDetail`）定位 `YIR_INVALID_REQUEST` 的无效字段：`Field`、稳定的 `Reason`（如 `unsupported`、`required`）以及合同允许值 `Allowed`。
- Veo 3.0（`google/veo-3.0-generate-001`）与 Gemini Omni 预览版（`google/gemini-omni-video`）已下架：API 目录和早期版本内置的审阅快照中都已移除。请求它们会返回 `YIR_INVALID_REQUEST`，`details[0].reason` 为 `retired`，`allowed` 给出替代模型。
- 与本 SDK 同批发布的 Gateway 变化：`parameters` 必填；不再接受顶层 `resolution`、`aspect_ratio`、`n`、`duration`、`generate_audio`、`input.image`，以及大小写不同的 `input.type` 或参考角色；`resolution` 与 `aspect_ratio` 必须是模型合同中的取值（不区分大小写），`1024`、`2048x2048`、`16x9` 等写法会被拒绝。模型别名精简为短名、厂商模型 ID，以及存在时的 Vercel AI Gateway ID；建议使用 `bytedance/seedance-2.0` 这类规范 ID。

## 0.10.0 变化

0.10.0 未单独发布，内容随 0.11.0 一起发布。

0.10.0 为 minor 版本，含不兼容变更，移除 Gateway 已不再使用的接口：

- `Quote` 删除 `Max`、`SingleAttemptUpperBound` 与 `HasVerifiableUpperBound`，`QuoteSupply` 删除 `RequiresMaxCost`。Gateway 仍为旧版 SDK 返回这些常量，本 SDK 忽略它们。估价读 `Primary`，预算由应用自行设置 `MaxCost`。
- 删除 `JobBilling.Savings` 与 `Savings` 类型，Gateway 自 2026-10-02 起不再返回；改用 `OfficialComparison`。
- 删除 `ModelParameterContract.Policy`、`ParameterPolicy` 类型以及报价/提交时的日志提醒。模型合同不再携带 policy；实际参数处理由报价和 Job 的 `ParameterNotices` 报告。
- 删除 `RoutingPreferenceBalanced`。Gateway 仍把 `balanced` 当作 `cost` 的别名接受，请改用 `RoutingPreferenceCost`。

## 0.9.0 变化

0.9.0 为 minor 版本，与 0.8.0 兼容。

- `Result.ContentSafety`（`*ResultContentSafety`）说明交付的结果是否通过 NSFW 检测、由谁检测：`Status` 为 `"passed"` 时，`CheckedBy` 为 `"provider"` 表示上游渠道对该路线执行审核，为 `"yir"` 表示 Yir 自行检测；`Status` 为 `"unchecked"` 表示无法检测。该字段上线前交付的结果为 `nil`。为 `passed` 时可以跳过你自己的 NSFW 检测，否则按你自己的策略处理。Yir 自己的输出检测只拦露骨成人内容。未通过检测的输出不会交付，Job 以 `YIR_CONTENT_REJECTED` 失败；上游已生成并计费，因此按上游费用收费。
- 新增 `RoutingPreferenceCost`、`RoutingPreferenceSpeed` 与已弃用的 `RoutingPreferenceBalanced`，对应 `Routing.Preference` 的取值。`speed` 按观测到的上游耗时升序排列渠道，样本不足的渠道排在其后并按价格排序；默认仍为 `cost`；`balanced` 是 `cost` 的别名，Gateway 仍接受。`Preference` 仍是由 Gateway 校验的字符串，旧版 SDK 也可向支持的 Gateway 发送 `speed`。

## 0.8.0 变化

0.8.0 为 minor 版本。调用签名不变，但以下行为有变化，请检查依赖这些行为的代码：

- 接受比 SDK 更新的 Job 与文件状态。只有 `succeeded`、`failed`、`cancelled` 表示 Job 结束，只有 `ready`、`failed`、`expired` 表示文件有结果；其余非空状态都视为进行中。提交、`GetJob`、`GetJobStatus`、`CancelJob` 与文件读取遇到新状态不再返回 `response_invalid`，`WaitJob` 会继续轮询，请用 context 限定等待时间。对 `Status` 的 `switch` 需要 default 分支。
- `WaitForFileReady`、`UploadFile` 与 `CreateAndUploadFile` 遇到 `processing` 及更新的状态会等待。此前 `CreateAndUploadFile` 遇到仍在 `processing` 的重放会返回 `file_not_ready`。
- `ConstructWebhookEvent` 收到签名有效、但不是终态 Job 的 JSON 对象（例如比 SDK 更新的事件类型）时，以 `Reason` `unsupported_event` 报告，并带上投递的 `ID` 与 `Timestamp`，不再是 `invalid_payload`。应返回 2xx 确认收到并记录日志。`invalid_payload` 现在只表示请求体不是 JSON 对象。
- 通过 `ClientOptions.ModelContracts` 创建的客户端只对目录描述的模型、操作和输入方式应用目录，其余交由 Gateway 判断，不再以 `model_contract_unavailable` 失败。要继续把请求限定在目录内，请调用仍然严格的 `ValidateGenerationWithCatalog`。
- 币种不是 USD 的报价返回 `ErrQuoteCurrencyUnsupported`（`quote_currency_unsupported`），不再是 `quote_response_invalid`；`Quote.Validate`、`QuoteImage`、`QuoteVideo` 与 `QuoteBatch` 均如此。此类报价仍会被拒绝。

兼容的新增：

- `GetModel` 接受比 SDK 更新的操作、输入方式、币种、可用性取值和规则行为。
- `Job`、`JobStatusResponse`、`Quote`、`File` 与 `ModelDetail` 新增 `RawJSON()`，返回解码时的原始 JSON，新字段可在 SDK 发版前读取。
- `APIError.RequestID` 是失败 HTTP 请求的 `request_id`。
- `WaitJob` 默认长轮询：每次状态查询请 Gateway 挂起最多 `DefaultStatusWait`（20 秒）直到状态变化，Yir 记录终态后约 1 秒即可拿到。挂起时长收进 HTTP 客户端超时与 context 截止时间之内，Gateway 未挂起时回退到 `PollDelay`。`WaitOptions.StatusWait` 设为负值可关闭。新增 `GetJobStatusWithWait`。

## 0.7.0 变化

0.7.0 为 minor 版本，含不兼容变更：

- 新增显式 `BillingMode: "actual"`（见下文“报价与提交”）。
- `ComputeCharge` 只描述由 Yir 计费的托管供给：`Amount` 由 `*string` 改为 `string`，已退役的 BYOK 取值不再出现。读取 `Amount` 的代码需去掉解引用。

现有协议可以表达的模型、参数和价格变化，不再需要发布 SDK：

- `GetModelContracts` 与 `GetModelContract` 忽略比 SDK 更新的字段，接受新的操作、输入方式、参数类型与控件。SDK 不认识的规则键交由 Gateway 判断，已知规则含义不变、照常校验；新参数类型的取值不在本地检查。
- 未配置目录时使用的 `ValidateGenerationProtocol` 只检查协议骨架。提示词长度、引用来源与 `file_id` 格式、路由 provider 代码、偏好与上限由 Gateway 校验。`GenerationRequest.Extra` 用于发送比 SDK 更新的顶层字段，反序列化已保存的请求时会恢复。SDK 已建模的字段（`model`、`input`、`parameters`、`routing`、`billing_mode`、`max_cost`、`webhook_url`）放进 `Extra` 会以 `reserved_field` 拒绝，且不会从中发送。
- `Quote.Validate` 对金额、币种与价格大小关系仍严格校验，但接受新的价格类型（金额须为十进制或 nil）、供给问题、原因以及估算范围和用量指标。`QuoteBatch` 条目接受任意错误码。
- `ValidateGeneration` 与 `ValidateModelParameters` 已弃用：它们使用随包的历史目录。请改用 `ValidateGenerationWithCatalog` 并传入当前 `GetModelContracts` 数据。

## 0.6.1

0.6.1 与 0.6.0 兼容。渠道价格缺少 `estimated` 或渠道参数缺少 `parameter_rules` 时，`GetModel` 返回 `model_response_invalid`，不再按 `false` 或空值读取。内置 `minimax/minimax-h3` 描述与服务端当前导出一致。

## 0.5.1

0.5.1 与 0.5.0 兼容。`Job` 新增 `FinalProvider`、`URLs`、`Usage`；`JobBilling` 新增 `ComputeCharges`、`GatewayFee`、`Savings`、`OfficialComparison`。新增 `ErrCode*` 常量与 `Version`，User-Agent 改为报告 SDK 版本。内置模型合同与服务端当前导出一致：新增 `alibaba/qwen-image-2.1`，Gemini Omni 接受 `duration`，`wan-2.6` 最多 5 个参考，移除 `kie/gemini-omni-video` 别名。仅显式使用内置合同的校验入口受影响；未传调用方目录的运行时请求不变。检查 `Result.Availability`，在 URL 过期前复制可用结果文件。

## 0.4.0 变化

未设置 `WaitOptions.PollInterval` 时，`WaitJob` 改为按 `PollDelay` 退避（5 秒、10 秒、20 秒），不再每 2 秒轮询；需要固定间隔时设置 `PollInterval`。新增 `ConstructWebhookEvent`。调用签名不变。0.4.1 起 `ConstructWebhookEvent` 同样拒绝 `GetJob` 不接受的 Job ID，并明确 `PollDelay` 的 `poll` 为刚完成查询的 0 基序号。0.4.2 起 `Quote.Validate` 同样拒绝 `supply` 与价格矛盾的报价，与 TypeScript 校验一致。

## 0.3.0 迁移

**Go 0.3.0** 的生成方法最后一个键参数由 `string` 改为 `...string`，按模块 0.x 版本规则属于公共 API 不兼容变更。`client.SubmitImage(ctx, request, savedKey)` 等普通调用仍可编译，也可省略键；`SubmitVideo` 同样变化。

自定义接口应声明 `SubmitImage(context.Context, yir.SubmitRequest, ...string) (yir.Job, error)`，视频方法做对应修改。方法值不再匹配 `func(context.Context, yir.SubmitRequest, string) (yir.Job, error)`；需要保留原函数类型时可包装：

```go
submit := func(ctx context.Context, request yir.SubmitRequest, key string) (yir.Job, error) {
    return client.SubmitImage(ctx, request, key)
}
```

见[编译检查迁移示例](../../client_example_test.go)。

## 0.2.0 合同更新

H3 reference 合同允许 1–15 项引用：图片最多 9 项、视频和音频各最多 3 项，可仅使用音频，保留 URL 与顺序。图生视频仍仅允许 adaptive。2026-09-16 已验证的 KIE 集成支持上述数量范围内的混合引用，但至少需要一项图片或视频；纯音频虽符合公共合同，仍不被该供应接受。每段视频或音频须为 2–15 秒，视频和音频各自总时长最多 15 秒。音视频须使用属于调用者、已完成可信测量且 ready 的 Files，以 `file_id` 引用；图片 URL 继续兼容。报价和准入使用可信测量，提交校验绑定的测量快照。其他渠道仍遵循各自支持的子集。完整请求必须取得有效报价；SDK 静态校验不代表在线可用或实际生成成功。此前 1–5 张图片的限制属于历史供应快照，不是当前 KIE 集成边界。

任务结果可包含 `result.warnings: ["additional_results_unavailable"]`，表示主要结果已交付，但可选附加结果未能交付。任务仍为 `succeeded`，`files` 仅含成功交付的文件；正常或历史响应可省略警告，结果过期后仍可保留历史警告。这不是生成失败，不授权自动重生成，不改变费用或 `parameter_notices`。

Seedance 2.0 支持可选布尔参数 `return_last_frame`（默认 false），其他模型拒绝该参数。请求尾帧需要覆盖完整费用的有效报价，不得套用普通视频价格；真实尾帧交付仍待验证。

Seedream 5.0 的文本和图片合同现接受 `4K`，图片输入最多允许 14 张参考图，其他参数不变。此合同更新不代表 4K 已在线可用，也不确认价格或精确输出尺寸；这些仍需服务端集成与报价确认。

当前工作版本在 Nano Banana 2 的文本和图片输入 `Parameters` 中接受可选布尔值 `web_search`、`image_search`，默认均为 false；图片搜索要求同时开启网页搜索。Nano Banana Pro 的文本和图片输入仅接受可选布尔值 `web_search`（默认 false），拒绝 `image_search`，包括显式 false；其余模型拒绝这两个字段。供应商搜索执行仍待实证，本次元数据更新不改变价格或开放供应。校验保留原请求，并执行按角色数量、必选角色组合、输出时长限制及重复引用检查。搜索可用性与费用需要支持该能力的供应和有效报价确认。这些更新尚未包含在已发布的 `v0.1.0` 模块中。

当前开发分支新增 `GetJobStatus`（`GET /v1/jobs/{id}/status`），并将 `WaitJob` 改造为两阶段轮询：先轮询轻量状态摘要 `JobStatusResponse`，进入终态（`succeeded`、`failed`、`cancelled`）后再读取一次完整 `Job`；终态状态不一致时返回 `ErrJobStateInconsistent`。`WaitOptions.OnPoll` 接收类型由完整 `Job` 改为 `JobStatusResponse` 摘要。等待中断（context 取消、超时）以及传输、校验或状态一致性错误时返回零值 `Job{}`，不伪造残缺任务；`JobError` 作为唯一例外返回完整的失败或已取消终态 `Job`。查询 status 遇到 404 错误时不静默回退到详情接口。已交付结果保留可选 `result.warnings`。上述状态轮询及零 Job 返回契约属于新特性，未包含在已发布的 `v0.1.0` 中；这些不兼容变化进入 0.2.0，升级时请按迁移说明调整调用方。
