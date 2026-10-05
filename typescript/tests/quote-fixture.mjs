export function quoteFixture(request, operation = "generate_image") {
  return {
    supply: { available: true, issues: [] },
    object: "quote", model: request.model, operation, input_mode: request.input.type,
    parameters: request.parameters, currency: "USD", expires_at: 1900000000,
    primary: { kind: "fixed", amount: "0.02" },
    official: { kind: "fixed", amount: "0.10" },
  };
}
