import { generatedModelContractCatalog } from "./generated/model-contracts.generated.ts";

export type ModelContractLocale = {
  readonly label: string;
  readonly description: string;
};

export type ModelParameterValue = string | number | boolean;

export type ModelParameterContract = {
  readonly name: string;
  /** Newer types may appear; local validation skips them. */
  readonly type: "string" | "integer" | "number" | "boolean" | (string & {});
  readonly required: boolean;
  readonly values?: readonly ModelParameterValue[];
  readonly default?: ModelParameterValue;
  readonly minimum?: number;
  readonly maximum?: number;
  /** Rendering hint; newer controls may appear and should fall back to a generic input. */
  readonly control: "select" | "aspect_ratio" | "number" | "toggle" | "file" | "text" | (string & {});
  readonly locales: Readonly<Record<string, ModelContractLocale>>;
};

export type ReferenceRole = "first_frame" | "last_frame" | "reference_image" | "reference_video" | "reference_audio" | (string & {});

export type ModelInputConstraint = {
  readonly min_references: number;
  readonly max_references: number;
  readonly allowed_reference_roles: readonly ReferenceRole[];
  readonly required_reference_roles?: readonly ReferenceRole[];
  readonly max_duration_by_reference_role?: Readonly<Record<string, number>>;
  readonly reference_counts_by_role?: Readonly<Record<string, { readonly minimum: number; readonly maximum: number }>>;
  readonly required_any_reference_roles?: readonly string[];
};

export type ModelOperationContract = {
  readonly operation: "generate_image" | "generate_video" | "upscale_image" | (string & {});
  readonly input_modes: readonly ("text" | "image" | "reference" | (string & {}))[];
  readonly input_constraints: Readonly<Record<string, ModelInputConstraint>>;
  readonly request_schema: string;
  readonly parameters: readonly ModelParameterContract[];
};

export type StaticModelContract = {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly locales: Readonly<Record<string, ModelContractLocale>>;
  readonly operations: readonly ModelOperationContract[];
};

export type ModelContractCatalog = {
  readonly schema_version: "v1";
  readonly schema_ref: string;
  readonly version?: string;
  readonly models: readonly StaticModelContract[];
};

export type KnownModelID = (typeof generatedModelContractCatalog.models)[number]["id"];

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const modelContracts: readonly StaticModelContract[] = deepFreeze(
  generatedModelContractCatalog.models,
);

/** Returns the immutable model contracts bundled with this SDK version. */
export function listModelContracts(): readonly StaticModelContract[] {
  return modelContracts;
}

/** Resolves a canonical model ID or an explicitly published alias. */
export function getModelContract(model: string): StaticModelContract | undefined {
  const normalized = model.trim();
  if (!normalized) return undefined;
  return modelContracts.find(
    (contract) => contract.id === normalized || contract.aliases.includes(normalized),
  );
}

/** Returns the static parameter contract for one operation and input mode. */
export function getModelOperationContract(
  model: string,
  operation: ModelOperationContract["operation"],
  inputMode: ModelOperationContract["input_modes"][number],
): ModelOperationContract | undefined {
  return getModelContract(model)?.operations.find(
    (contract) => contract.operation === operation && contract.input_modes.includes(inputMode),
  );
}
