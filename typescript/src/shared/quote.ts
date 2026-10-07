import type { Quote, QuoteBatch, QuoteBatchRequestItem } from "./types.js";
import { findModelContract, type ModelContractCatalog } from "./catalog.js";

const decimal = /^[0-9]+(?:\.[0-9]+)?$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Validate the response before exposing prices as authorization inputs.
 * Amounts and currency stay strict; deprecated fields are ignored, and price kinds, supply issues,
 * reasons and usage fields newer than this SDK are accepted as data.
 */
export function validateQuoteResponse(
  value: unknown,
  request: { readonly model: string; readonly input: { readonly type: string } },
  operation: Quote["operation"],
  catalog?: ModelContractCatalog,
): Quote {
  const invalid = () => { throw new Error("quote_response_invalid"); };
  if (!record(value) || value.object !== "quote" || typeof value.currency !== "string" || !value.currency.trim()) return invalid();
  // Amounts in another currency must not be compared with USD budgets; fail
  // closed with a distinct error so callers can tell it from a malformed quote.
  if (value.currency !== "USD") throw new Error("quote_currency_unsupported");
  // An alias may be echoed as its canonical ID; compare through the catalog when it knows the request.
  const requested = catalog ? findModelContract(catalog, request.model) : undefined;
  const returned = requested && typeof value.model === "string" ? findModelContract(catalog!, value.model) : undefined;
  const echoMatches = typeof value.model === "string" &&
    (value.model === request.model.trim() || /^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(value.model));
  if (!echoMatches || (requested && returned?.id !== requested.id)
    || value.operation !== operation || value.input_mode !== request.input.type
    || !record(value.parameters) || !Number.isSafeInteger(value.expires_at)
    || (value.expires_at as number) <= 0) return invalid();
  if (!record(value.supply) || typeof value.supply.available !== "boolean" || !Array.isArray(value.supply.issues)
    || !value.supply.issues.every((issue) => typeof issue === "string" && issue.trim())) return invalid();
  const prices = [value.primary, value.official];
  for (const price of prices) {
    if (!record(price)) return invalid();
    if (price.kind === "fixed") {
      if (typeof price.amount !== "string" || !decimal.test(price.amount)
        || (price.reason !== undefined && price.reason !== "") || price.estimate != null) return invalid();
    } else if (price.kind === "estimate") {
      if (typeof price.amount !== "string" || !decimal.test(price.amount)
        || (price.reason !== undefined && price.reason !== "") || !record(price.estimate)
        || typeof price.estimate.scope !== "string" || !price.estimate.scope.trim()) return invalid();
      // Newer usage metrics may replace these; known ones must still be sane.
      const tokens = price.estimate.output_tokens, megapixels = price.estimate.output_megapixels;
      const validQuantity = (v: unknown) => v === undefined || Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 1_000_000;
      if (!validQuantity(tokens) || !validQuantity(megapixels) || (tokens !== undefined && megapixels !== undefined)) return invalid();
      for (const field of ["quality", "aspect_ratio"]) {
        const condition = price.estimate[field];
        if (condition !== undefined && (typeof condition !== "string" || !condition.trim())) return invalid();
      }
    } else if (price.kind === "unavailable") {
      if (price.amount !== null || typeof price.reason !== "string" || !price.reason.trim() || price.estimate != null) return invalid();
    } else if (typeof price.kind !== "string" || !price.kind.trim()
      || (price.amount != null && (typeof price.amount !== "string" || !decimal.test(price.amount)))) return invalid();
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
  if (value.expected_amount !== undefined && (typeof value.expected_amount !== "string" || !decimal.test(value.expected_amount))) return invalid();
  const quote = value as unknown as Quote;
  // Without supply there is nothing to authorize, so no amount may be offered.
  if (!quote.supply.available && (quote.supply.issues.length === 0 || quote.primary.amount !== null || quote.expected_amount !== undefined)) return invalid();
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
      } catch (error) {
        if (error instanceof Error && error.message === "quote_currency_unsupported") throw error;
        return invalid();
      }
      continue;
    }
    const error = item.error;
    if (!record(error) || typeof error.code !== "string" || !error.code.trim() || typeof error.message !== "string"
      || !error.message.trim() || typeof error.retryable !== "boolean"
      || (error.action !== undefined && typeof error.action !== "string")) return invalid();
  }
  return value as QuoteBatch;
}
