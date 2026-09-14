/** Pure local pricing. This table never grants execution or spending authority. */
export type PriceParameter = string | number | boolean;
export interface PriceTable {
  format: "yir-price-table-v1";
  version: string;
  purpose: "retail" | "yir-cost";
  /** Amounts are integer atoms; e.g. unit=credit, scale=100 means hundredths. */
  unit: string;
  scale: number;
  rows: PriceRow[];
}
export interface PriceRow {
  id: string;
  model: string;
  operation: string;
  /** Every pricing parameter must be present; values are finite allowed sets. */
  conditions: Record<string, PriceParameter[]>;
  kind: "exact" | "estimate";
  /** Human-readable scope/assumptions, required for estimates. */
  description?: string | null;
  price: { type: "total"; amount: string } | {
    type: "unit";
    amount: string;
    quantity: string;
    per: string;
    rounding: "ceil" | "floor" | "half-up";
  };
}
export interface PriceInput {
  model: string;
  operation: string;
  /** Supply normalized pricing dimensions only, not prompts or arbitrary form data. */
  parameters: Record<string, PriceParameter>;
  version: string;
}
export type PriceResult = {
  kind: "exact" | "estimate";
  amount: string;
  rowId: string;
  version: string;
  purpose: PriceTable["purpose"];
  unit: string;
  scale: number;
  description?: string;
} | { kind: "unavailable"; reason: "invalid_table" | "invalid_input" | "version_mismatch" | "no_match" | "ambiguous_match" | "overflow" };

const MAX = 9223372036854775807n;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const scalar = (v: unknown): v is PriceParameter => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isSafeInteger(v));
function integer(v: unknown): bigint | undefined {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(v)) return undefined;
  const n = BigInt(v);
  return n <= MAX ? n : undefined;
}

/** Validates untrusted JSON without modifying or defaulting it. */
export function isPriceTable(v: unknown): v is PriceTable {
  if (!object(v) || v.format !== "yir-price-table-v1" || !text(v.version) ||
      !["retail", "yir-cost"].includes(v.purpose as string) || !text(v.unit) ||
      !Number.isSafeInteger(v.scale) || (v.scale as number) <= 0 || !Array.isArray(v.rows)) return false;
  const ids = new Set<string>();
  for (const r of v.rows) {
    if (!object(r) || !text(r.id) || ids.has(r.id) || !text(r.model) || !text(r.operation) ||
        !object(r.conditions) || !["exact", "estimate"].includes(r.kind as string) ||
        (r.description !== undefined && r.description !== null && r.description !== "" && !text(r.description)) || (r.kind === "estimate" && !text(r.description)) ||
        !object(r.price) || integer(r.price.amount) === undefined) return false;
    ids.add(r.id);
    for (const [key, values] of Object.entries(r.conditions)) {
      if (!text(key) || !Array.isArray(values) || values.length === 0 || !values.every(scalar) || new Set(values).size !== values.length) return false;
    }
    if (r.price.type === "unit") {
      const per = integer(r.price.per);
      if (!text(r.price.quantity) || per === undefined || per === 0n ||
          !["ceil", "floor", "half-up"].includes(r.price.rounding as string)) return false;
      const allowed = r.conditions[r.price.quantity];
      if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.every(x => typeof x === "number" && Number.isSafeInteger(x) && x >= 0)) return false;
    } else if (r.price.type !== "total") return false;
  }
  return true;
}

/** No network, mutation, model defaults, membership rules, or implicit currency conversion. */
export function calculatePrice(table: unknown, input: PriceInput): PriceResult {
  const unavailable = (reason: Extract<PriceResult, {kind: "unavailable"}>["reason"]): PriceResult => ({kind: "unavailable", reason});
  if (!isPriceTable(table)) return unavailable("invalid_table");
  if (!object(input) || !text(input.model) || !text(input.operation) || !text(input.version) ||
      !object(input.parameters) || !Object.values(input.parameters).every(scalar)) return unavailable("invalid_input");
  if (input.version !== table.version) return unavailable("version_mismatch");
  const matches = table.rows.filter(r => r.model === input.model && r.operation === input.operation &&
    Object.keys(r.conditions).length === Object.keys(input.parameters).length &&
    Object.entries(r.conditions).every(([key, allowed]) => Object.hasOwn(input.parameters, key) && allowed.includes(input.parameters[key]!)));
  if (matches.length === 0) return unavailable("no_match");
  if (matches.length !== 1) return unavailable("ambiguous_match");
  const row = matches[0]!;
  let amount = BigInt(row.price.amount);
  if (row.price.type === "unit") {
    const numerator = amount * BigInt(input.parameters[row.price.quantity] as number);
    // Bound intermediates identically in Go and TS, even if division would fit.
    if (numerator > MAX) return unavailable("overflow");
    const divisor = BigInt(row.price.per);
    amount = numerator / divisor;
    const remainder = numerator % divisor;
    if ((row.price.rounding === "ceil" && remainder > 0n) ||
        (row.price.rounding === "half-up" && remainder * 2n >= divisor)) amount += 1n;
  }
  return {kind: row.kind, amount: amount.toString(), rowId: row.id, version: table.version,
    purpose: table.purpose, unit: table.unit, scale: table.scale,
    ...(row.description ? {description: row.description} : {})};
}
