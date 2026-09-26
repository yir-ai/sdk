import type { Quote, QuoteBatch, QuoteBatchRequestItem } from "./types.js";
import { findModelContract, type ModelContractCatalog } from "./catalog.js";

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
  catalog?: ModelContractCatalog,
): Quote {
  const invalid = () => { throw new Error("quote_response_invalid"); };
  if (!record(value)) return invalid();
  const expectedModel = catalog ? findModelContract(catalog, request.model)?.id ?? request.model : request.model;
  const returnedModel = catalog && typeof value.model === "string"
    ? findModelContract(catalog, value.model)?.id ?? value.model : value.model;
  if (value.object !== "quote" || value.currency !== "USD"
    || typeof value.model !== "string" || !expectedModel || returnedModel !== expectedModel
    || value.operation !== operation || value.input_mode !== request.input.type
    || !record(value.parameters) || !Number.isSafeInteger(value.expires_at)
    || (value.expires_at as number) <= 0 || typeof value.has_verifiable_upper_bound !== "boolean") return invalid();
  if (!record(value.supply) || typeof value.supply.available !== "boolean"
    || typeof value.supply.requires_max_cost !== "boolean" || !Array.isArray(value.supply.issues)
    || !value.supply.issues.every((issue) => issue === "no_matching_supply")) return invalid();
  const prices = [value.primary, value.max, value.official];
  for (const price of prices) {
    if (!record(price)) return invalid();
    if (price.kind === "fixed") {
      if (typeof price.amount !== "string" || !decimal.test(price.amount)
        || (price.reason !== undefined && price.reason !== "") || price.estimate != null) return invalid();
    } else if (price.kind === "estimate") {
      if (typeof price.amount !== "string" || !decimal.test(price.amount)
        || (price.reason !== undefined && price.reason !== "") || !record(price.estimate)
        || price.estimate.scope !== "output_only") return invalid();
      const tokens = price.estimate.output_tokens, megapixels = price.estimate.output_megapixels;
      const validQuantity = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 1_000_000;
      if (!((validQuantity(tokens) && megapixels === undefined) || (validQuantity(megapixels) && tokens === undefined))) return invalid();
      for (const field of ["quality", "aspect_ratio"]) {
        const condition = price.estimate[field];
        if (condition !== undefined && (typeof condition !== "string" || !condition.trim())) return invalid();
      }
    } else if (price.kind === "unavailable") {
      if (price.amount !== null || typeof price.reason !== "string" || !price.reason.trim() || price.estimate != null) return invalid();
    } else return invalid();
  }
  if (value.price_difference_percent !== undefined) {
    if (!record(value.price_difference_percent)) return invalid();
    const diff = value.price_difference_percent;
    if (typeof diff.min !== "number" || !Number.isFinite(diff.min)
      || typeof diff.max !== "number" || !Number.isFinite(diff.max)
      || diff.min > diff.max) return invalid();
    if (diff.reference_amount_micros !== undefined
      && (!Number.isSafeInteger(diff.reference_amount_micros) || (diff.reference_amount_micros as number) < 0)) return invalid();
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
  if (quote.supply.available) {
    if (quote.supply.issues.length !== 0
      || (!quote.has_verifiable_upper_bound && !quote.supply.requires_max_cost)
      || (quote.primary.kind === "unavailable" && quote.primary.reason === "no_matching_supply")
      || (quote.max.kind === "unavailable" && quote.max.reason === "no_matching_supply")) return invalid();
  } else if (quote.supply.requires_max_cost || quote.supply.issues.length !== 1
    || quote.supply.issues[0] !== "no_matching_supply" || quote.has_verifiable_upper_bound
    || quote.primary.kind !== "unavailable" || quote.max.kind !== "unavailable"
    || quote.primary.reason !== "no_matching_supply" || quote.max.reason !== "no_matching_supply") return invalid();
  return quote;
}

export function validateQuoteBatchResponse(
  value: unknown,
  requests: readonly QuoteBatchRequestItem[],
  catalog?: ModelContractCatalog,
): QuoteBatch {
  const invalid = () => { throw new Error("quote_batch_response_invalid"); };
  if (!record(value) || value.object !== "quote_batch" || typeof value.request_id !== "string"
    || !value.request_id.trim() || !Array.isArray(value.data) || value.data.length !== requests.length) return invalid();
  for (let i = 0; i < requests.length; i++) {
    const item = value.data[i];
    if (!record(item) || item.index !== i || (item.quote === undefined) === (item.error === undefined)) return invalid();
    if (item.quote !== undefined) {
      const request = requests[i]!;
      try {
        validateQuoteResponse(item.quote, request.request, request.operation, catalog);
      } catch {
        return invalid();
      }
      continue;
    }
    const error = item.error;
    if (!record(error) || error.code !== "YIR_INVALID_REQUEST" || typeof error.message !== "string"
      || !error.message.trim() || error.retryable !== false || error.action !== "fix_request") return invalid();
  }
  return value as QuoteBatch;
}
