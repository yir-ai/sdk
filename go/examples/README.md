# Go examples

English | [简体中文](../docs/zh-CN/examples.md) · [Go guide](../README.md)

[client_example_test.go](../client_example_test.go) is a compile-checked lifecycle sketch: create a client, quote an image, require a verifiable fixed-price budget, then submit and wait. It is not a standalone command. Before adapting its Submit call, implement customer budget approval and persist the complete `SubmitRequest` and stable key in your own task record. Recovery reads that record without replacing its request or key. Save the returned job ID and resume polling by ID when available.

The example has no `Output` directive, so `go test` compiles it without executing API calls. Copying it into an application and calling it can submit paid work; only do so after implementing the approval/persistence step. A timeout does not prove failure or imply a refund. Reconcile terminal billing once, including `JobError` paths, and copy result files before expiry.

[pricing_example_test.go](../pricing_example_test.go) demonstrates local price helpers; prices are calculation inputs rather than generation authorization or customer billing policy.

From `go/`, focused verification (with `GOWORK=off` and `GOMAXPROCS=2`):

```sh
go test -p 2 -run Example ./...
```

This compiles all package examples and runs only examples that declare expected output. It does not run the API lifecycle sketch.
