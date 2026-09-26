import { generatedModelContractCatalog } from "./generated/model-contracts.generated.ts";

export type ModelContractLocale = {
  readonly label: string;
  readonly description: string;
};

export type ModelParameterValue = string | number | boolean;

export type ModelParameterContract = {
  readonly policy?: { readonly only_provider: string; readonly reason: string; readonly message: string };
  readonly name: string;
  readonly type: "string" | "integer" | "number" | "boolean";
  readonly required: boolean;
  readonly values?: readonly ModelParameterValue[];
  readonly default?: ModelParameterValue;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly control: "select" | "aspect_ratio" | "number" | "toggle" | "file" | "text";
  readonly locales: Readonly<Record<string, ModelContractLocale>>;
};

export type ModelInputConstraint = {
  readonly min_references: number;
  readonly max_references: number;
  readonly allowed_reference_roles: readonly (
    | "first_frame"
    | "last_frame"
    | "reference_image"
    | "reference_video"
    | "reference_audio"
  )[];
  readonly required_reference_roles?: readonly ModelInputConstraint["allowed_reference_roles"][number][];
  readonly max_duration_by_reference_role?: Readonly<Record<string, number>>;
  readonly reference_counts_by_role?: Readonly<Record<string, { readonly minimum: number; readonly maximum: number }>>;
  readonly required_any_reference_roles?: readonly string[];
};

export type ModelOperationContract = {
  readonly operation: "generate_image" | "generate_video" | "upscale_image";
  readonly input_modes: readonly ("text" | "image" | "reference")[];
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
