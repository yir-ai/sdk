import type { ModelContractCatalog, ModelOperationContract, ModelParameterContract, StaticModelContract } from "./model-contracts.js";
import type { ChannelParameters } from "./parameter-rules.js";

export type { ModelContractCatalog, ModelOperationContract, StaticModelContract, ModelParameterContract, ModelInputConstraint } from "./model-contracts.js";

export type ModelContractDetail = {
  readonly schema_version: "v1";
  readonly schema_ref: string;
  readonly version: string;
  readonly model: StaticModelContract;
};

export function modelContractPath(model: string): string {
  if (!canonicalModelID(model)) throw new Error("model_contract_request_invalid");
  return `/v1/models/${model}?view=contract`;
}

/** Market display pricing, not a quote. amount_micros is absent when no price is published. */
export type ModelChannelPrice = {
  readonly provider_code: string;
  readonly provider_label: string;
  readonly amount_micros?: number;
  readonly availability: "available" | "unavailable" | (string & {});
  readonly estimated: boolean;
  readonly specification_label: string;
};

export type ModelSpecification = {
  readonly request_model_id: string;
  readonly operation: "generate_image" | "generate_video" | (string & {});
  readonly input_mode: "text" | "image" | "reference" | (string & {});
  readonly specification_label: string;
  readonly currency: "USD" | (string & {});
  readonly channels: readonly ModelChannelPrice[];
};

export type ModelDetail = {
  readonly id: string;
  readonly object: "model";
  readonly specifications: readonly ModelSpecification[];
  readonly channel_parameters?: readonly ChannelParameters[];
};

export function modelDetailPath(model: string): string {
  if (!canonicalModelID(model)) throw new Error("model_request_invalid");
  return `/v1/models/${model}`;
}

/** Checks the facts callers rely on; unknown display fields are kept so server additions do not break older SDKs. */
export function parseModelDetail(value: unknown, requestedModel: string): ModelDetail {
  const fail = (): never => { throw new Error("model_response_invalid"); };
  const record = (item: unknown): PlainObject => item && typeof item === "object" && !Array.isArray(item) ? item as PlainObject : fail();
  const text = (item: unknown) => typeof item === "string" && item.length > 0;
  const root = record(value);
  if (root.id !== requestedModel || root.object !== "model" || !Array.isArray(root.specifications) || !root.specifications.length) fail();
  for (const item of root.specifications as unknown[]) {
    const specification = record(item);
    if (!canonicalModelID(specification.request_model_id) || !text(specification.operation) || !text(specification.input_mode) ||
        !text(specification.specification_label) || !text(specification.currency) ||
        !Array.isArray(specification.channels) || !specification.channels.length) fail();
    for (const entry of specification.channels as unknown[]) {
      const channel = record(entry);
      if (!text(channel.provider_code) || !text(channel.provider_label) || !text(channel.specification_label) ||
          !text(channel.availability) || typeof channel.estimated !== "boolean" ||
          (channel.amount_micros !== undefined && (!Number.isSafeInteger(channel.amount_micros) || (channel.amount_micros as number) < 0))) fail();
    }
  }
  if (root.channel_parameters !== undefined) {
    if (!Array.isArray(root.channel_parameters)) fail();
    for (const entry of root.channel_parameters as unknown[]) {
      const channel = record(entry);
      if (!text(channel.provider) || !text(channel.channel_variant) || !text(channel.operation) || !text(channel.input_mode)) fail();
      for (const rule of Object.values(record(channel.parameter_rules))) {
        if (!text(record(rule).behavior)) fail();
      }
    }
  }
  return root as ModelDetail;
}

function canonicalModelID(model: unknown): model is string {
  return typeof model === "string" && /^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/.test(model) &&
    model.split("/").every(part => part.length <= 100);
}

export function parseModelContractDetail(value: unknown, requestedModel: string): ModelContractDetail {
  const root = object(value);
  if (typeof root.version !== "string" || !/^[a-f0-9]{64}$/.test(root.version)) invalid();
  const catalog = parseModelContractCatalog({
    schema_version: root.schema_version, schema_ref: root.schema_ref,
    version: root.version, models: [root.model],
  });
  const model = catalog.models[0];
  if (!model || model.id !== requestedModel) invalid();
  return {
    schema_version: catalog.schema_version, schema_ref: catalog.schema_ref,
    version: root.version, model,
  };
}

type PlainObject = Record<string, unknown>;

/**
 * Parse external API data before using it for local validation. Fields and enum
 * values newer than this SDK are kept and left to the Gateway; known rules keep
 * their meaning and are still enforced. Malformed known fields still fail.
 */
export function parseModelContractCatalog(value: unknown): ModelContractCatalog {
  const root = object(value);
  if (root.schema_version !== "v1") throw new Error("model_contract_schema_unsupported");
  nonemptyString(root.schema_ref);
  if (root.version !== undefined) nonemptyString(root.version);
  const models = list(root.models);
  if (models.length === 0) invalid();
  const identities = new Set<string>();
  for (const rawModel of models) {
    const model = object(rawModel);
    nonemptyString(model.id);
    localized(model.locales);
    for (const id of [model.id, ...list(model.aliases)]) {
      nonemptyString(id);
      if (identities.has(id as string)) invalid();
      identities.add(id as string);
    }
    const operations = list(model.operations);
    if (operations.length === 0) invalid();
    const operationModes = new Set<string>();
    for (const rawOperation of operations) {
      const operation = object(rawOperation);
      nonemptyString(operation.operation);
      nonemptyString(operation.request_schema);
      const modes = list(operation.input_modes);
      const constraints = object(operation.input_constraints);
      if (modes.length === 0) invalid();
      for (const mode of modes) {
        nonemptyString(mode);
        const key = `${operation.operation}:${mode}`;
        if (operationModes.has(key)) invalid();
        operationModes.add(key);
        const constraint = object(constraints[mode as string]);
        integerRange(constraint.min_references, constraint.max_references);
        const allowed = list(constraint.allowed_reference_roles);
        for (const role of allowed) nonemptyString(role);
        for (const key of ["required_reference_roles", "required_any_reference_roles"]) {
          if (constraint[key] !== undefined) for (const role of list(constraint[key])) oneOf(role, allowed);
        }
        if (constraint.reference_counts_by_role !== undefined) {
          for (const [role, rawRange] of Object.entries(object(constraint.reference_counts_by_role))) {
            oneOf(role, allowed);
            const count = object(rawRange);
            integerRange(count.minimum, count.maximum);
          }
        }
        if (constraint.max_duration_by_reference_role !== undefined) {
          for (const [role, max] of Object.entries(object(constraint.max_duration_by_reference_role))) {
            oneOf(role, allowed);
            natural(max);
          }
        }
      }
      const parameters = list(operation.parameters);
      const names = new Set<string>();
      for (const rawParameter of parameters) {
        const parameter = object(rawParameter);
        nonemptyString(parameter.name);
        if (names.has(parameter.name as string)) invalid();
        names.add(parameter.name as string);
        nonemptyString(parameter.type);
        if (typeof parameter.required !== "boolean") invalid();
        nonemptyString(parameter.control);
        localized(parameter.locales);
        for (const bound of [parameter.minimum, parameter.maximum]) {
          if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound) ||
              ["string", "boolean"].includes(parameter.type as string))) invalid();
        }
        if (typeof parameter.minimum === "number" && typeof parameter.maximum === "number" && parameter.minimum > parameter.maximum) invalid();
        const values = parameter.values === undefined ? undefined : list(parameter.values);
        if (values && values.length === 0) invalid();
        // Values of a newer parameter type are left to the Gateway.
        if (!knownParameterTypes.includes(parameter.type as string)) continue;
        for (const item of [...(values ?? []), ...(Object.hasOwn(parameter, "default") ? [parameter.default] : [])]) {
          const valid = parameter.type === "integer" ? typeof item === "number" && Number.isSafeInteger(item)
            : parameter.type === "number" ? typeof item === "number" && Number.isFinite(item)
            : typeof item === parameter.type;
          if (!valid || typeof item === "number" &&
            (typeof parameter.minimum === "number" && item < parameter.minimum ||
             typeof parameter.maximum === "number" && item > parameter.maximum)) invalid();
        }
        if (values && Object.hasOwn(parameter, "default") && !values.includes(parameter.default)) invalid();
      }
    }
  }
  return structuredClone(value) as ModelContractCatalog;
}

function invalid(): never { throw new Error("model_contract_invalid"); }
function object(value: unknown): PlainObject {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid();
  return value as PlainObject;
}
function list(value: unknown): unknown[] { if (!Array.isArray(value)) invalid(); return value; }
function nonemptyString(value: unknown): void { if (typeof value !== "string" || !value.trim()) invalid(); }
function oneOf(value: unknown, allowed: readonly unknown[]): void { if (!allowed.includes(value)) invalid(); }
function natural(value: unknown): void { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(); }
function integerRange(min: unknown, max: unknown): void {
  natural(min); natural(max);
  if ((min as number) > (max as number)) invalid();
}

const knownParameterTypes = ["string", "integer", "number", "boolean"];

/** Values of a parameter type newer than this SDK are checked by the Gateway only. */
export function parameterTypeKnown(parameter: ModelParameterContract): boolean {
  return knownParameterTypes.includes(parameter.type);
}
function localized(value: unknown): void {
  const entries = Object.entries(object(value));
  if (entries.length === 0) invalid();
  for (const [, raw] of entries) {
    const text = object(raw);
    nonemptyString(text.label);
    if (typeof text.description !== "string") invalid();
  }
}

/** Looks up caller-owned API data or a generated models.ts snapshot. */
export function findModelContract(catalog: ModelContractCatalog, model: string): StaticModelContract | undefined {
  if (catalog.schema_version !== "v1") throw new Error("model_contract_schema_unsupported");
  const id = model.trim();
  return catalog.models.find(item => item.id === id || item.aliases.includes(id));
}

export function findModelOperationContract(
  catalog: ModelContractCatalog,
  model: string,
  operation: ModelOperationContract["operation"],
  inputMode: ModelOperationContract["input_modes"][number],
): ModelOperationContract | undefined {
  return findModelContract(catalog, model)?.operations.find(
    item => item.operation === operation && item.input_modes.includes(inputMode),
  );
}
