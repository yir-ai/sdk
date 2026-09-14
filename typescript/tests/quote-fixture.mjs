export function quoteFixture(request, operation = "generate_image") {
  return {
    supply: { available: true, issues: [] },
    object: "quote", model: request.model, operation, input_mode: request.input.type,
    parameters: request.parameters, currency: "USD", expires_at: 1900000000,
    primary: { kind: "fixed", amount: "0.02" },
    max: { kind: "fixed", amount: "0.05" },
    official: { kind: "fixed", amount: "0.10" },
    has_verifiable_upper_bound: true, single_attempt_upper_bound: "0.05",
  };
}
