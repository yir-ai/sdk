# AGENTS.md

## 验证

- 本地只跑与改动相关的定向验证：Go 用 `go test -run X ./pkg/...`，TypeScript 只跑相关测试文件与必要的类型检查。
- 完整的 `pnpm check`、`go test ./...` 由 GitHub Actions CI（`.github/workflows/ci.yml`）执行；CI 失败时本地只复现失败项。
