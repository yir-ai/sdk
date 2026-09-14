import { isPriceTable, type PriceTable, type PriceInput, type PriceParameter } from "./pricing.js";
import type { ChannelParameters } from "./parameter-rules.js";
import { getModelContract, getModelOperationContract } from "./model-contracts.js";
import { validateGeneration, type StandardImageQuoteRequest, type StandardVideoQuoteRequest } from "./standard.js";

export interface ModelPriceFilter {
  resolution?: string;
  reference_count?: number;
}

export interface ModelPrices {
  channel_parameters?: readonly ChannelParameters[];
  id: string;
  object: "model_prices";
  operation: "generate_image" | "generate_video";
  input_mode: "text" | "image" | "reference";
  contract_version: string;
  /** Coverage applies only to the requested filter, not the entire model. */
  coverage: "enumerated" | "partial";
  issues: string[];
  filter?: ModelPriceFilter;
  prices: {
    primary: PriceTable;
    max: PriceTable;
    expires_at: number;
    unavailable: {id: string; model: string; operation: string; conditions: Record<string, PriceParameter[]>; basis: "primary" | "max"; reason: string}[];
  };
}

export function modelPricesPath(model: string, operation: ModelPrices["operation"], inputMode: ModelPrices["input_mode"], filter: ModelPriceFilter = {}): string {
  if (typeof model !== "string") throw new Error("model_prices_request_invalid");
  const id = getModelContract(model)?.id ?? model;
  if (!/^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/.test(id) || id.split("/").some(x => x.length > 100) ||
      !["generate_image", "generate_video"].includes(operation) || !["text", "image", "reference"].includes(inputMode)) throw new Error("model_prices_request_invalid");
  if (!validFilter(filter, inputMode)) throw new Error("model_prices_request_invalid");
  return `/v1/models/${id}?view=pricing&operation=${operation}&input_mode=${inputMode}` +
    (filter.resolution === undefined ? "" : `&resolution=${encodeURIComponent(filter.resolution.toLowerCase())}`) +
    (filter.reference_count === undefined ? "" : `&reference_count=${filter.reference_count}`);
}

function validFilter(filter: ModelPriceFilter, mode: string): boolean {
  return !!filter && typeof filter === "object" && !Array.isArray(filter) && Object.keys(filter).every(k => k === "resolution" || k === "reference_count") &&
    (filter.resolution === undefined || (typeof filter.resolution === "string" && /^[a-z0-9.]{1,32}$/i.test(filter.resolution))) &&
    (filter.reference_count === undefined || (mode === "image" && Number.isInteger(filter.reference_count) && filter.reference_count >= 1 && filter.reference_count <= 512));
}

function matchesFilter(conditions: Record<string, PriceParameter[]>, filter: ModelPriceFilter): boolean {
  if (filter.resolution !== undefined && (conditions.resolution?.length !== 1 || conditions.resolution[0] !== filter.resolution.toLowerCase())) return false;
  if (filter.reference_count !== undefined) {
    let count = 0;
    for (const role of ["source_image", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"]) {
      const values = conditions[`${role}_count`];
      if (values?.length !== 1 || typeof values[0] !== "number" || !Number.isSafeInteger(values[0]) || values[0] < 0 || values[0] > 512) return false;
      count += values[0];
    }
    if (count !== filter.reference_count) return false;
  }
  return true;
}

export function validateModelPrices(value: unknown, model: string, operation: ModelPrices["operation"], inputMode: ModelPrices["input_mode"], filter: ModelPriceFilter = {}): ModelPrices {
  const fail = (): never => { throw new Error("model_prices_response_invalid"); };
  const v = value as ModelPrices;
  if (!validFilter(filter,inputMode) || (v?.filter !== undefined && !validFilter(v.filter,inputMode)) ||
      (v?.filter?.resolution ?? "") !== (filter.resolution?.toLowerCase() ?? "") || v?.filter?.reference_count !== filter.reference_count) return fail();
  if (!v || v.object !== "model_prices" || v.id !== (getModelContract(model)?.id ?? model) || v.operation !== operation || v.input_mode !== inputMode ||
      typeof v.contract_version !== "string" || !v.contract_version || !["enumerated", "partial"].includes(v.coverage) || !Array.isArray(v.issues) ||
      !v.issues.every(x => typeof x === "string") || !v.prices || !Number.isSafeInteger(v.prices.expires_at) || v.prices.expires_at <= 0 || !Array.isArray(v.prices.unavailable)) return fail();
  for (const table of [v.prices.primary, v.prices.max]) {
    if (!isPriceTable(table) || table.purpose !== "yir-cost" || table.unit !== "USD" || table.scale !== 1_000_000 ||
        table.rows.some(row => row.model !== v.id || row.operation !== operation || row.conditions.input_mode?.length !== 1 || row.conditions.input_mode[0] !== inputMode || !matchesFilter(row.conditions,filter))) return fail();
  }
  for (const row of v.prices.unavailable) {
    if (!row || !["primary", "max"].includes(row.basis) || typeof row.reason !== "string" || !row.reason || row.model !== v.id || row.operation !== operation ||
        !isPriceTable({...v.prices.primary, rows: [{...row, kind: "exact", price: {type: "total", amount: "0"}}]}) ||
        row.conditions.input_mode?.length !== 1 || row.conditions.input_mode[0] !== inputMode || !matchesFilter(row.conditions,filter)) return fail();
  }
  return v;
}

/** Map a Standard request to the server price table's dimensions without I/O.
 * Uses bundled defaults; table matching still fails closed for unsupported combinations.
 * Does not modify the request or convert procurement cost to retail credits.
 */
export function buildPriceInput(operation: ModelPrices["operation"], request: StandardImageQuoteRequest | StandardVideoQuoteRequest, version: string): PriceInput {
  validateGeneration(operation, request);
  if (request.routing !== undefined) throw new Error("model_price_routing_override_unsupported");
  const contract = getModelOperationContract(request.model, operation, request.input.type)!;
  const parameters: Record<string, PriceParameter> = {};
  for (const rule of contract.parameters) {
    if (rule.name === "seed") continue;
    const value = request.parameters[rule.name] ?? rule.default;
    if (value !== undefined) parameters[rule.name] = value as PriceParameter;
  }
  parameters.input_mode = request.input.type;
  parameters.resolution = String(parameters.resolution).toLowerCase();
  if (operation === "generate_image") parameters.quality ??= "";
  else parameters.duration ??= 0;
  for (const role of ["source_image", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"]) parameters[`${role}_count`] = 0;
  if (request.input.type !== "text") for (const reference of request.input.references) {
    const key = `${reference.role}_count`;
    parameters[key] = (parameters[key] as number) + 1;
  }
  return {model: getModelContract(request.model)!.id, operation, parameters, version};
}
