# AI SDK core parameter compatibility

Scope: this development branch, AI SDK 7.0.97 / Provider V4 4.0.13. This is code and contract-test coverage, not a claim about the published npm package or live channel availability.

| AI SDK option / combination | Yir mapping | Compatibility and limits |
| --- | --- | --- |
| prompt, n, seed | input.prompt, parameters.n, parameters.seed | Forwarded; zero seed is preserved. One invocation stays one Job; unsupported counts fail instead of automatic fan-out. |
| Image size + aspectRatio | parameters.size + aspect_ratio | Exact dimensions; no tier approximation. Gateway rejects inconsistent proportions and unverified sizes. |
| Video resolution + fps | parameters.size + fps | Pixel resolution is different from native tier parameters.resolution (720p etc.). Forwarding does not imply any model/channel accepts the combination. Only verified native FPS routes qualify. |
| Video duration + generateAudio | parameters.duration + generate_audio | Seconds and false are preserved; omitted settings remain omitted. |
| Automatic duration + reference video | providerOptions.yir.parameters.duration = auto | Native extension, not the AI SDK numeric duration option. Seedance 2.5 reference mode requires a reference video and inherited aspect. URL Quote does not download or measure media: eligible supply may be available while both amounts remain null and expected_amount is absent. Submit imports and measures URLs before admission. Quote and Job echoes preserve auto; historical numeric duration stays numeric. |
| Video adaptive aspect | parameters.aspect_ratio | For media inputs, a supplied model/input-mode catalog can map adaptive to auto. Explicit native auto is also supported; without either, adaptive is forwarded unchanged. |
| First/last frames and inputReferences | role-tagged input.references | Frame order and roles preserved; simultaneous frame and reference modes explicitly rejected. Inline inputs use Files; URLs retain their source. |
| Omitted prompt + first frame | image input with empty prompt | Only verified model/channel combinations (currently Veo 3.1 first-frame route); text-only generation still requires text. Last-frame support must be checked separately. |
| Image mask | unsupported | Explicit error before upload or Submit. Requires a separately approved public contract to add support. |
| Conflicting standard/native value | parameter_conflict | Rejected before upload or Submit. Different keys such as size and aspect_ratio are checked together by Gateway. |

Validation is layered: vercel.test.mjs exercises real AI SDK calls and captures outbound Standard API requests; duration-auto-contract.test.mjs and external-model-contracts.test.mjs exercise local contract handling. vercel-auto-quote.test.mjs covers single/batch URL quote parsing, echo reuse, status recovery and numeric/auto conflicts. Core API tests cover exact-size conflicts, native-FPS supply restrictions, optional prompts and measured automatic duration. Worker tests cover native aspect/duration serialization and FPS rejection. These are independent deterministic tests, not a deployed end-to-end run. Current availability, media inspection and billing remain server decisions.

Migration: standard AI SDK options and orchestration are reusable, while model IDs, Yir providerOptions, Files, Job handles and billing require replacement when moving to another provider. This supports an AI SDK integration claim, not a zero-change migration guarantee.
