import type { Quote } from "./types.js";
import { getModelContract } from "./model-contracts.js";

const decimal = /^[0-9]+(?:\.[0-9]+)?$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Compare decimal strings without rounding customer money through Number.
function compare(a: string, b: string): number {
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const left = ai!.replace(/^0+/, "") || "0";
  const right = bi!.replace(/^0+/, "") || "0";
  if (left.length !== right.length) return left.length - right.length;
  if (left !== right) return left < right ? -1 : 1;
  const width = Math.max(af.length, bf.length);
  const x = af.padEnd(width, "0"), y = bf.padEnd(width, "0");
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Validate the response before exposing prices as authorization inputs. */
export function validateQuoteResponse(
  value: unknown,
  request: { readonly model: string; readonly input: { readonly type: string } },
  operation: Quote["operation"],
): Quote {
  const invalid = () => { throw new Error("quote_response_invalid"); };
  if (!record(value)) return invalid();
  if (value.object !== "quote" || value.currency !== "USD"
    || typeof value.model !== "string" || !getModelContract(value.model)
    || getModelContract(value.model)?.id !== getModelContract(request.model)?.id
    || value.operation !== operation || value.input_mode !== request.input.type
    || !record(value.parameters) || !Number.isSafeInteger(value.expires_at)
    || (value.expires_at as number) <= 0 || typeof value.has_verifiable_upper_bound !== "boolean") return invalid();
  const prices = [value.primary, value.max, value.official];
  for (const price of prices) {
    if (!record(price)) return invalid();
    if (price.kind === "fixed") {
      if (typeof price.amount !== "string" || !decimal.test(price.amount)
        || (price.reason !== undefined && price.reason !== "") || price.estimate != null) return invalid();
    } else if (price.kind === "estimate") {
      if (typeof price.amount !== "string" || !decimal.test(price.amount)
        || (price.reason !== undefined && price.reason !== "") || !record(price.estimate)
        || price.estimate.scope !== "output_only" || !Number.isSafeInteger(price.estimate.output_tokens)
        || (price.estimate.output_tokens as number) <= 0 || (price.estimate.output_tokens as number) > 1_000_000) return invalid();
    } else if (price.kind === "unavailable") {
      if (price.amount !== null || typeof price.reason !== "string" || !price.reason.trim() || price.estimate != null) return invalid();
    } else return invalid();
  }
  const quote = value as unknown as Quote;
  if (quote.primary.amount !== null && quote.max.amount !== null
    && compare(quote.primary.amount, quote.max.amount) > 0) return invalid();
  if (quote.has_verifiable_upper_bound) {
    if (typeof quote.single_attempt_upper_bound !== "string" || !decimal.test(quote.single_attempt_upper_bound)) return invalid();
    for (const price of [quote.primary, quote.max]) {
      if (price.amount !== null && compare(price.amount, quote.single_attempt_upper_bound) > 0) return invalid();
    }
  } else if (quote.single_attempt_upper_bound !== null) return invalid();
  return quote;
}
