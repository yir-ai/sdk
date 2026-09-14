import {buildPriceInput, calculatePrice, getModelOperationContract} from '@yir/sdk/browser';

// Customer-side helper: persist/submit THIS request, not the original form data.
// Explicit defaults keep the priced parameters stable across server updates.
export function preparePricedRequest(operation, request) {
  const input = buildPriceInput(operation, request, 'request-validation');
  const prepared = structuredClone(request);
  prepared.model = input.model;
  const contract = getModelOperationContract(input.model, operation, request.input.type);
  for (const rule of contract.parameters) {
    if (prepared.parameters[rule.name] === undefined && rule.default !== undefined) {
      prepared.parameters[rule.name] = structuredClone(rule.default);
    }
  }
  return prepared;
}

// Caller selects the correctly keyed cache entry (account/policy/model/op/mode/
// filter). ModelPrices has already been validated by getModelPrices on loading.
// This helper does no fetching, has no cache, and cannot authorize a purchase.
export function previewCost(modelPrices, operation, request, nowSeconds) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error('invalid_clock');
  if (!modelPrices) return {state:'load_required'};
  if (modelPrices.prices.expires_at <= nowSeconds) return {state:'refresh_required'};
  const prepared = preparePricedRequest(operation, request);
  if (modelPrices.id !== prepared.model || modelPrices.operation !== operation || modelPrices.input_mode !== prepared.input.type) {
    return {state:'load_required'};
  }
  const table = modelPrices.prices.primary;
  const input = buildPriceInput(operation, prepared, table.version);
  const filter = modelPrices.filter;
  if (filter?.resolution && filter.resolution !== input.parameters.resolution) return {state:'load_required'};
  const references = prepared.input.type === 'text' ? 0 : prepared.input.references.length;
  if (filter?.reference_count !== undefined && filter.reference_count !== references) return {state:'load_required'};
  const price = calculatePrice(table,input);
  if (price.kind === 'unavailable') return {state:'unavailable',reason:price.reason};
  return {state:price.kind,price,request:prepared};
  // A missing row in partial coverage does not imply unsupported or free.
  // A published RETAIL table has its own acceptance policy; cost expiry must
  // never silently reprice or revoke an already accepted retail order.
}
