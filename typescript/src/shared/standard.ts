import { getModelOperationContract } from "./model-contracts.js";

export type RoutingPreference = "balanced" | "cost";

export type RoutingOverride = {
  readonly variants?: Readonly<Record<string, string>>;
  readonly preference?: RoutingPreference;
  readonly only?: readonly string[];
  readonly fallback?: boolean;
};

export type StandardTextInput = {
  readonly type: "text";
  readonly prompt: string;
};

export type StandardMediaSource =
  | { readonly url: string; readonly file_id?: never }
  | { readonly file_id: string; readonly url?: never };

export type StandardImageInput = {
  readonly type: "image";
  readonly prompt: string;
  readonly references: readonly StandardReference[];
};

export type StandardReference = {
  readonly role: "reference_image" | "first_frame" | "last_frame" | "reference_video" | "reference_audio";
} & StandardMediaSource;

export type StandardImageGenerationRequest = {
  readonly max_cost?: string;
  readonly model: string;
  readonly input: StandardTextInput | StandardImageInput;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly routing?: RoutingOverride;
	readonly webhook_url?: string;
};

export type StandardImageQuoteRequest = Omit<
  StandardImageGenerationRequest,
  "webhook_url" | "max_cost"
>;

export type StandardVideoImageInput = StandardImageInput;

export type StandardVideoReference = StandardReference;

export type StandardVideoReferenceInput = {
  readonly type: "reference";
  readonly prompt: string;
  readonly references: readonly StandardVideoReference[];
};

export type StandardVideoGenerationRequest = {
  readonly max_cost?: string;
	readonly model: string;
	readonly input:
		| StandardTextInput
		| StandardVideoImageInput
		| StandardVideoReferenceInput;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly routing?: RoutingOverride;
  readonly webhook_url?: string;
};

export type StandardVideoQuoteRequest = Omit<
  StandardVideoGenerationRequest,
  "webhook_url" | "max_cost"
>;

export type BuildImageGenerationRequest = {
  readonly maxCost?: string;
  readonly model: string;
  readonly prompt: string;
  readonly image?: StandardMediaSource;
  readonly references?: readonly StandardReference[];
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly routing?: RoutingOverride;
	readonly webhookUrl?: string;
};

export type BuildImageQuoteRequest = Omit<
  BuildImageGenerationRequest,
  "webhookUrl" | "maxCost"
>;

export class YirSDKValidationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string) {
    super(`${code}: ${path}`);
    this.name = "YirSDKValidationError";
    this.code = code;
    this.path = path;
  }
}

/** Validate bundled parameter rules without fetching rules or mutating caller data. */
export function validateModelParameters(
  model: string,
  operation: "generate_image" | "generate_video",
  inputMode: "text" | "image" | "reference",
  parameters: unknown,
): void {
  const contract = getModelOperationContract(model, operation, inputMode);
  if (!contract) throw new YirSDKValidationError("model_contract_unavailable", "model");
  const values = requireObject(parameters, "parameters");
  const rules = new Map(contract.parameters.map(rule => [rule.name, rule]));
  for (const key of Object.keys(values).sort()) {
    if (!rules.has(key)) throw new YirSDKValidationError("parameter_unknown", `parameters.${key}`);
  }
  for (const rule of contract.parameters) {
    const path = `parameters.${rule.name}`;
    if (!Object.hasOwn(values, rule.name)) {
      if (rule.required && rule.default === undefined) throw new YirSDKValidationError("parameter_required", path);
      continue;
    }
    const value = values[rule.name];
    const validType = rule.type === "integer" ? typeof value === "number" && Number.isSafeInteger(value)
      : rule.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : rule.type === "string" ? typeof value === "string"
      : rule.type === "boolean" ? typeof value === "boolean" : false;
    if (!validType) throw new YirSDKValidationError("parameter_type", path);
    if (typeof value === "number" &&
      ((rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum))) {
      throw new YirSDKValidationError("parameter_range", path);
    }
    if (rule.values && !rule.values.includes(value as string | number | boolean)) {
      throw new YirSDKValidationError("parameter_value", path);
    }
  }
  if (values.image_search === true && values.web_search !== true) {
    throw new YirSDKValidationError("parameter_dependency", "parameters.image_search");
  }
}

/** Shared Quote/Submit preflight; availability and pricing remain server facts. */
export function validateGeneration(operation: "generate_image" | "generate_video", request: unknown): void {
  const body = requireObject(request, "request");
  rejectUnknown(body, ["model", "input", "parameters", "routing", "max_cost", "webhook_url"], "request");
  if (typeof body.model !== "string" || !body.model.trim()) throw new YirSDKValidationError("model_required", "model");
  const input = requireObject(body.input, "input");
  rejectUnknown(input, ["type", "prompt", "references"], "input");
  if (input.type !== "text" && input.type !== "image" && input.type !== "reference") {
    throw new YirSDKValidationError("input_mode_invalid", "input.type");
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new YirSDKValidationError("prompt_required", "input.prompt");
  if ([...input.prompt].length > 20000) throw new YirSDKValidationError("prompt_too_long", "input.prompt");
  validateModelParameters(body.model, operation, input.type, body.parameters);
  const contract = getModelOperationContract(body.model, operation, input.type)!;
  const constraint = contract.input_constraints[input.type];
  if (!constraint) throw new YirSDKValidationError("model_contract_unavailable", "input.type");
  const references = input.references === undefined ? [] : input.references;
  if (!Array.isArray(references) || references.length < constraint.min_references || references.length > constraint.max_references) {
    throw new YirSDKValidationError("reference_count", "input.references");
  }
  const roles = new Map<string, number>();
  const seenReferences = new Set<string>();
  for (const [index, value] of references.entries()) {
    const path = `input.references.${index}`;
    const reference = requireObject(value, path);
    rejectUnknown(reference, ["role", "url", "file_id"], path);
    if (typeof reference.role !== "string" || !constraint.allowed_reference_roles.some(role => role === reference.role)) {
      throw new YirSDKValidationError("reference_role_invalid", `${path}.role`);
    }
    roles.set(reference.role, (roles.get(reference.role) ?? 0) + 1);
    const identity = JSON.stringify([reference.role, reference.url ?? null, reference.file_id ?? null]);
    if (seenReferences.has(identity)) throw new YirSDKValidationError("duplicate_reference", "input.references");
    seenReferences.add(identity);
    if (Object.hasOwn(reference, "url") === Object.hasOwn(reference, "file_id")) {
      throw new YirSDKValidationError("reference_source_invalid", path);
    }
    if (Object.hasOwn(reference, "url")) {
      validateHTTPSURL(reference.url, `${path}.url`);
    } else if (typeof reference.file_id !== "string" || !/^file_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reference.file_id)) {
      throw new YirSDKValidationError("file_id_invalid", `${path}.file_id`);
    }
  }
  for (const role of constraint.required_reference_roles ?? []) {
    if (!roles.has(role)) throw new YirSDKValidationError("reference_role_required", "input.references");
  }
  for (const [role, limit] of Object.entries(constraint.reference_counts_by_role ?? {})) {
    const count = roles.get(role) ?? 0;
    if (count < limit.minimum || count > limit.maximum) {
      throw new YirSDKValidationError("reference_role_count", "input.references");
    }
  }
  if (constraint.required_any_reference_roles?.length && !constraint.required_any_reference_roles.some(role => roles.has(role))) {
    throw new YirSDKValidationError("reference_role_required", "input.references");
  }
  const durationRule = contract.parameters.find(parameter => parameter.name === "duration");
  const duration = (body.parameters as Record<string, unknown> | undefined)?.duration ?? durationRule?.default;
  for (const [role, maximum] of Object.entries(constraint.max_duration_by_reference_role ?? {})) {
    if (roles.has(role) && typeof duration === "number" && duration > maximum) {
      throw new YirSDKValidationError("reference_duration_limit", "parameters.duration");
    }
  }
  if (operation === "generate_video" && input.type === "image" &&
      (roles.get("first_frame") !== 1 || (roles.get("last_frame") ?? 0) > 1)) {
    throw new YirSDKValidationError("frame_roles_invalid", "input.references");
  }
  normalizeRoutingOverride(body.routing as RoutingOverride | undefined);
  if (Object.hasOwn(body, "max_cost")) {
    const amount = body.max_cost;
    if (typeof amount !== "string" || amount.length > 20 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(amount)) {
      throw new YirSDKValidationError("max_cost_invalid", "max_cost");
    }
    const [whole, fraction = ""] = amount.split(".");
    // Match the server's signed int64 micro-dollar storage without Number rounding.
    if (BigInt(whole! + fraction.padEnd(6, "0")) > 9223372036854775807n) {
      throw new YirSDKValidationError("max_cost_invalid", "max_cost");
    }
  }
  if (Object.hasOwn(body, "webhook_url")) validateHTTPSURL(body.webhook_url, "webhook_url");
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new YirSDKValidationError("object_required", path);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new YirSDKValidationError("unknown_field", `${path}.${key}`);
  }
}

function validateHTTPSURL(value: unknown, path: string): void {
  try {
    if (typeof value !== "string") throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
  } catch {
    throw new YirSDKValidationError("url_invalid", path);
  }
}

/**
 * Normalize the caller-owned routing override without introducing route facts.
 * Provider availability, credentials, ordering and
 * pricing remain Gateway responsibilities.
 */
export function normalizeRoutingOverride(
  routing?: RoutingOverride,
): RoutingOverride | undefined {
  if (routing === undefined) return undefined;
  if (routing === null || typeof routing !== "object" || Array.isArray(routing)) {
    throw new YirSDKValidationError("routing_invalid", "routing");
  }
  const unknownField = Object.keys(routing).find(
    (field) => !ROUTING_OVERRIDE_FIELDS.has(field),
  );
  if (unknownField) {
    throw new YirSDKValidationError("routing_unknown_field", `routing.${unknownField}`);
  }

  const preference = routing.preference;
  if (preference !== undefined && preference !== "balanced" && preference !== "cost") {
    throw new YirSDKValidationError("routing_preference_invalid", "routing.preference");
  }
  const only = normalizeProviders(routing.only, 16, true, "routing.only");
  let variants: Record<string, string> | undefined;
  if (routing.variants !== undefined) {
    if (!routing.variants || typeof routing.variants !== "object" || Array.isArray(routing.variants) || Object.keys(routing.variants).length === 0 || Object.keys(routing.variants).length > 16) {
      throw new YirSDKValidationError("routing_invalid", "routing.variants");
    }
    for (const [provider, variant] of Object.entries(routing.variants)) {
      if (provider.length > 50 || !ROUTING_PROVIDER_CODE_PATTERN.test(provider) || typeof variant !== "string" || variant.length > 50 || !ROUTING_PROVIDER_CODE_PATTERN.test(variant) || (only && !only.includes(provider))) {
        throw new YirSDKValidationError("routing_invalid", "routing.variants");
      }
    }
    variants = Object.fromEntries(Object.entries(routing.variants).sort(([a], [b]) => a.localeCompare(b)));
  }
  if (routing.fallback !== undefined && typeof routing.fallback !== "boolean") {
    throw new YirSDKValidationError("routing_fallback_invalid", "routing.fallback");
  }

  const normalized: RoutingOverride = {
    ...(variants ? { variants } : {}),
    ...(preference ? { preference } : {}),
    ...(only ? { only } : {}),
    ...(routing.fallback === undefined ? {} : { fallback: routing.fallback }),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** Build the portable Yir Standard image request shared by Playground and SDK consumers. */
export function buildImageGenerationRequest(
  input: BuildImageGenerationRequest,
): StandardImageGenerationRequest {
  const model = input.model.trim();
  if (!model) throw new YirSDKValidationError("model_required", "model");
  const prompt = input.prompt.trim();
  if (!prompt) throw new YirSDKValidationError("prompt_required", "input.prompt");
  if (prompt.length > 20_000) throw new YirSDKValidationError("prompt_too_long", "input.prompt");
  const parameters = input.parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new YirSDKValidationError("parameters_required", "parameters");
  }

  const routing = normalizeRoutingOverride(input.routing);
  const webhookUrl = normalizeWebhookURL(input.webhookUrl);
  const image = input.image;
  if (image !== undefined) {
    if (!image || typeof image !== "object" || Array.isArray(image) ||
      Object.keys(image).some(key => key !== "url" && key !== "file_id") ||
      (("url" in image) === ("file_id" in image))) {
      throw new YirSDKValidationError("image_source_invalid", "input.image");
    }
    const value = "url" in image ? image.url : image.file_id;
    if (typeof value !== "string" || !value.trim()) {
      throw new YirSDKValidationError("image_source_invalid", "input.image");
    }
  }
  if (image !== undefined && input.references !== undefined) {
    throw new YirSDKValidationError("reference_source_ambiguous", "input.references");
  }
  const references = image === undefined ? input.references : [{ role: "reference_image" as const, ...image }];
  const request: StandardImageGenerationRequest = {
    model,
    input: references === undefined ? { type: "text", prompt } : { type: "image", prompt, references },
    parameters,
    ...(routing ? { routing } : {}),
    ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    ...(input.maxCost === undefined ? {} : { max_cost: input.maxCost }),
  };
  validateGeneration("generate_image", request);
  return request;
}

/** Build the read-only Quote request from the same normalized image contract. */
export function buildImageQuoteRequest(
  input: BuildImageQuoteRequest,
): StandardImageQuoteRequest {
  const { webhook_url: _webhookURL, max_cost: _maxCost, ...request } = buildImageGenerationRequest(input);
  return request;
}

function normalizeProviders(
  providers: readonly string[] | undefined,
  maximum: number,
  sort: boolean,
  path: string,
): readonly string[] | undefined {
  if (providers === undefined) return undefined;
  if (!Array.isArray(providers) || providers.length === 0 || providers.length > maximum) {
    throw new YirSDKValidationError("routing_provider_count", path);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    if (
      typeof provider !== "string" ||
      provider.length > 50 ||
      !ROUTING_PROVIDER_CODE_PATTERN.test(provider)
    ) {
      throw new YirSDKValidationError("routing_provider_code_invalid", path);
    }
    if (seen.has(provider)) {
      throw new YirSDKValidationError("routing_provider_duplicate", path);
    }
    seen.add(provider);
    normalized.push(provider);
  }
  return sort ? normalized.sort() : normalized;
}

const ROUTING_PROVIDER_CODE_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
const ROUTING_OVERRIDE_FIELDS = new Set(["preference", "only", "fallback", "variants"]);

function normalizeWebhookURL(value?: string): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new YirSDKValidationError("webhook_url_invalid", "webhook_url");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new YirSDKValidationError("webhook_url_invalid", "webhook_url");
  }
  return url.toString();
}
