import type { ModelContractCatalog, ModelOperationContract, StaticModelContract } from "./model-contracts.js";

export type { ModelContractCatalog, ModelOperationContract, StaticModelContract, ModelParameterContract, ModelInputConstraint } from "./model-contracts.js";

export type ModelContractDetail = {
  readonly schema_version: "v1";
  readonly schema_ref: string;
  readonly version: string;
  readonly model: StaticModelContract;
};

export function modelContractPath(model: string): string {
  if (typeof model !== "string" || !/^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/.test(model) ||
      model.split("/").some(part => part.length > 100)) throw new Error("model_contract_request_invalid");
  return `/v1/models/${model}?view=contract`;
}

export function parseModelContractDetail(value: unknown, requestedModel: string): ModelContractDetail {
  const root = object(value);
  knownKeys(root, ["schema_version", "schema_ref", "version", "model"]);
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
const referenceRoles = ["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"];

/** Parse external API data before using it for local validation. Unknown rules fail closed. */
export function parseModelContractCatalog(value: unknown): ModelContractCatalog {
  const root = object(value);
  knownKeys(root, ["schema_version", "schema_ref", "version", "models"]);
  if (root.schema_version !== "v1") throw new Error("model_contract_schema_unsupported");
  nonemptyString(root.schema_ref);
  if (root.version !== undefined) nonemptyString(root.version);
  const models = list(root.models);
  if (models.length === 0) invalid();
  const identities = new Set<string>();
  for (const rawModel of models) {
    const model = object(rawModel);
    knownKeys(model, ["id", "aliases", "locales", "operations"]);
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
      knownKeys(operation, ["operation", "input_modes", "input_constraints", "request_schema", "parameters"]);
      oneOf(operation.operation, ["generate_image", "generate_video", "upscale_image"]);
      nonemptyString(operation.request_schema);
      const modes = list(operation.input_modes);
      const constraints = object(operation.input_constraints);
      if (modes.length === 0 || Object.keys(constraints).length !== modes.length) invalid();
      for (const mode of modes) {
        oneOf(mode, ["text", "image", "reference"]);
        const key = `${operation.operation}:${mode}`;
        if (operationModes.has(key)) invalid();
        operationModes.add(key);
        const constraint = object(constraints[mode as string]);
        knownKeys(constraint, ["min_references", "max_references", "allowed_reference_roles", "required_reference_roles", "max_duration_by_reference_role", "reference_counts_by_role", "required_any_reference_roles"]);
        integerRange(constraint.min_references, constraint.max_references);
        const allowed = list(constraint.allowed_reference_roles);
        for (const role of allowed) oneOf(role, referenceRoles);
        for (const key of ["required_reference_roles", "required_any_reference_roles"]) {
          if (constraint[key] !== undefined) for (const role of list(constraint[key])) oneOf(role, allowed);
        }
        if (constraint.reference_counts_by_role !== undefined) {
          for (const [role, rawRange] of Object.entries(object(constraint.reference_counts_by_role))) {
            oneOf(role, allowed);
            const count = object(rawRange);
            knownKeys(count, ["minimum", "maximum"]);
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
        knownKeys(parameter, ["policy", "name", "type", "required", "values", "default", "minimum", "maximum", "control", "locales"]);
        nonemptyString(parameter.name);
        if (names.has(parameter.name as string)) invalid();
        names.add(parameter.name as string);
        oneOf(parameter.type, ["string", "integer", "number", "boolean"]);
        if (typeof parameter.required !== "boolean") invalid();
        oneOf(parameter.control, ["select", "aspect_ratio", "number", "toggle", "file", "text"]);
        localized(parameter.locales);
        for (const bound of [parameter.minimum, parameter.maximum]) {
          if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound) ||
              !["integer", "number"].includes(parameter.type as string))) invalid();
        }
        if (typeof parameter.minimum === "number" && typeof parameter.maximum === "number" && parameter.minimum > parameter.maximum) invalid();
        const values = parameter.values === undefined ? undefined : list(parameter.values);
        if (values && values.length === 0) invalid();
        for (const item of [...(values ?? []), ...(Object.hasOwn(parameter, "default") ? [parameter.default] : [])]) {
          const valid = parameter.type === "integer" ? typeof item === "number" && Number.isSafeInteger(item)
            : parameter.type === "number" ? typeof item === "number" && Number.isFinite(item)
            : typeof item === parameter.type;
          if (!valid || typeof item === "number" &&
            (typeof parameter.minimum === "number" && item < parameter.minimum ||
             typeof parameter.maximum === "number" && item > parameter.maximum)) invalid();
        }
        if (values && Object.hasOwn(parameter, "default") && !values.includes(parameter.default)) invalid();
        if (parameter.policy !== undefined) {
          const policy = object(parameter.policy);
          knownKeys(policy, ["only_provider", "reason", "message"]);
          nonemptyString(policy.only_provider);
          nonemptyString(policy.reason);
          nonemptyString(policy.message);
        }
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
function knownKeys(value: PlainObject, names: readonly string[]): void {
  if (Object.keys(value).some(key => !names.includes(key))) throw new Error("model_contract_semantics_unsupported");
}
function localized(value: unknown): void {
  const entries = Object.entries(object(value));
  if (entries.length === 0) invalid();
  for (const [, raw] of entries) {
    const text = object(raw);
    knownKeys(text, ["label", "description"]);
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
