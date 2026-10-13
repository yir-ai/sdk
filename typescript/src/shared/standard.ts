import { findModelOperationContract, parameterTypeKnown, type ModelContractCatalog } from "./catalog.js";
import type { ModelParameterContract, ReferenceRole } from "./model-contracts.js";

/**
 * Channel ordering for a request; the Gateway validates the value.
 * - "cost" (default): ascending price.
 * - "speed": ascending observed upstream latency; channels with too few samples follow in price order.
 */
export type RoutingPreference = "cost" | "speed" | (string & {});

/**
 * Lowest acceptable fidelity of the delivered file; the Gateway validates the value.
 * - "original": only routes verified as untouched vendor API output, plus the official channel.
 * - "genuine" (default): excludes routes known to upscale or otherwise alter the output.
 * - "any": no restriction; cheapest.
 * When every route is excluded the request fails with YIR_FIDELITY_EXCLUDED.
 */
export type RoutingFidelity = "original" | "genuine" | "any" | (string & {});

/**
 * Request-scoped routing intent.
 * "official" is supported as an alias for the model's official provider in both only and variants.
 */
export type RoutingOverride = {
  /** Omit a provider to consider all its eligible variants; specify standard to pin the standard version. */
  readonly variants?: Readonly<Record<string, string>>;
  readonly preference?: RoutingPreference;
  readonly only?: readonly string[];
  readonly fallback?: boolean;
  readonly fidelity?: RoutingFidelity;
  /**
   * Route acceleration; omitted uses the routing profile default (on). When an image attempt
   * stays unresolved upstream well past the channel's usual completion time and another
   * eligible route remains, the Gateway cuts it off and retries on the next route.
   * Requires fallback. Set false to always wait for the first channel.
   */
  readonly accelerate?: boolean;
};

export type StandardTextInput = {
  readonly type: "text";
  readonly prompt: string;
};

/** Exactly one source: a ready File ID or a public HTTPS URL that Yir imports at submission. */
export type StandardMediaSource =
  | { readonly file_id: string; readonly url?: never }
  | { readonly url: string; readonly file_id?: never };

export type StandardImageInput = {
  readonly type: "image";
  readonly prompt: string;
  readonly references: readonly StandardReference[];
};

export type StandardReference = {
  readonly role: ReferenceRole;
} & StandardMediaSource;

export type StandardImageGenerationRequest = {
  /** @deprecated Omit for new requests; actual-cost settlement is the default. Retained for legacy callers with the existing validation rules. */
  readonly billing_mode?: "actual";
  /** Optional total Job budget. A more expensive fallback can exceed the remaining budget and fail the Job with YIR_BUDGET_EXCEEDED. Omit for delivery continuity without a per-Job cap, or allow headroom for fallback and prior billed attempts. */
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

export type StandardVideoImageInput = Omit<StandardImageInput, "prompt"> & { readonly prompt?: string };

export type StandardVideoReference = StandardReference;

export type StandardVideoReferenceInput = {
  readonly type: "reference";
  readonly prompt: string;
  readonly references: readonly StandardVideoReference[];
};

export type StandardVideoGenerationRequest = {
  /** @deprecated Omit for new requests; actual-cost settlement is the default. Retained for legacy callers with the existing validation rules. */
  readonly billing_mode?: "actual";
  /** Optional total Job budget. A more expensive fallback can exceed the remaining budget and fail the Job with YIR_BUDGET_EXCEEDED. Omit for delivery continuity without a per-Job cap, or allow headroom for fallback and prior billed attempts. */
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

/** Music and sound-effect input: a prompt plus optional lyrics; no references. */
export type StandardMusicTextInput = {
  readonly type: "text";
  /** Style, mood and scenario of the music, or the description of a sound effect (per-model length limit). */
  readonly prompt: string;
  /**
   * Song lyrics, lines separated by \n; structure tags such as [Verse] and [Chorus] are allowed.
   * Only models that accept custom lyrics take this field. Vocal music needs lyrics,
   * parameters.lyrics_optimizer or parameters.instrumental as the model supports; omit it when
   * instrumental or lyrics_optimizer is true. Sound effects take no lyrics.
   */
  readonly lyrics?: string;
};

/**
 * Optional music and sound-effect parameters; omitted fields take the model's defaults and
 * a model accepts only the parameters its contract declares. There is no tempo or key
 * control; delivered audio reports its measured `duration_ms`.
 */
export type StandardMusicParameters = {
  /** Output length in seconds, only for length-priced models (ElevenLabs music and sound effects); allowed values and default come from the model contract. */
  readonly duration?: number;
  /** Generate music without vocals (default false). Omit input.lyrics and lyrics_optimizer. */
  readonly instrumental?: boolean;
  /** Write the lyrics from the prompt (default false). Omit input.lyrics; some models add a lyrics-writing charge shown in the quote. */
  readonly lyrics_optimizer?: boolean;
  /** Tracks per Job: 1 for most models; Suno always makes 2. */
  readonly n?: number;
  readonly [name: string]: unknown;
};

/** Music or sound-effect request: one Job delivers the tracks the model makes per request (two for Suno) as audio files behind short-lived links. */
export type StandardMusicGenerationRequest = {
  /** @deprecated Omit for new requests; actual-cost settlement is the default. Retained for legacy callers with the existing validation rules. */
  readonly billing_mode?: "actual";
  /** Optional total Job budget. A more expensive fallback can exceed the remaining budget and fail the Job with YIR_BUDGET_EXCEEDED. Omit for delivery continuity without a per-Job cap, or allow headroom for fallback and prior billed attempts. */
  readonly max_cost?: string;
  readonly model: string;
  readonly input: StandardMusicTextInput;
  /** Optional for music; omitted parameters take their published defaults. */
  readonly parameters?: StandardMusicParameters;
  readonly routing?: RoutingOverride;
  readonly webhook_url?: string;
};

export type StandardMusicQuoteRequest = Omit<
  StandardMusicGenerationRequest,
  "webhook_url" | "max_cost"
>;

/** Generation operations known to this SDK release. */
export type GenerationOperation = "generate_image" | "generate_video" | "generate_music" | "generate_sound_effect";

const isAudioOperation = (operation: string) => operation === "generate_music" || operation === "generate_sound_effect";

/** The music methods also serve sound-effect models: generate_music resolves to the operation the catalog declares. */
function resolveCatalogOperation(catalog: ModelContractCatalog, model: string, operation: GenerationOperation, inputMode: string): GenerationOperation {
  if (operation !== "generate_music" || findModelOperationContract(catalog, model, operation, inputMode)) return operation;
  return findModelOperationContract(catalog, model, "generate_sound_effect", inputMode) ? "generate_sound_effect" : operation;
}

export type BuildImageGenerationRequest = {
  /** Optional total Job budget. A more expensive fallback can exceed the remaining budget and fail the Job with YIR_BUDGET_EXCEEDED. Omit for delivery continuity without a per-Job cap, or allow headroom for fallback and prior billed attempts. */
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

export type ParameterExpectation = {
  readonly type?: ModelParameterContract["type"];
  readonly values?: readonly (string | number | boolean)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly required?: boolean;
  readonly allowed_parameters?: readonly string[];
};

export class YirSDKValidationError extends Error {
  readonly code: string;
  readonly path: string;
  readonly expected?: ParameterExpectation;

  constructor(code: string, path: string, expected?: ParameterExpectation) {
    super(`${code}: ${path}`);
    this.name = "YirSDKValidationError";
    this.code = code;
    this.path = path;
    if (expected !== undefined) {
      this.expected = expected;
    }
  }
}

/** Validate caller-supplied parameter rules without fetching or mutating data. */
export function validateModelParameters(
  model: string,
  operation: GenerationOperation,
  inputMode: string,
  parameters: unknown,
  catalog: ModelContractCatalog,
): void {
  if (!catalog) throw new YirSDKValidationError("model_contract_required", "catalog");
  const contract = findModelOperationContract(catalog, model, resolveCatalogOperation(catalog, model, operation, inputMode), inputMode);
  if (!contract) throw new YirSDKValidationError("model_contract_unavailable", "model");
  const values = requireObject(parameters, "parameters");
  const rules = new Map(contract.parameters.map(rule => [rule.name, rule]));
  for (const key of Object.keys(values).sort()) {
    if (!rules.has(key)) {
      const allowed_parameters = Object.freeze(contract.parameters.map(rule => rule.name));
      throw new YirSDKValidationError("parameter_unknown", `parameters.${key}`, {
        allowed_parameters,
      });
    }
  }
  for (const rule of contract.parameters) {
    const path = `parameters.${rule.name}`;
    // A parameter type newer than this SDK is evaluated by the Gateway, not guessed locally.
    if (!parameterTypeKnown(rule)) continue;
    if (!Object.hasOwn(values, rule.name)) {
      if (rule.required && rule.default === undefined) {
        const expected: ParameterExpectation = {
          required: true,
          type: rule.type,
          ...(rule.values ? { values: Object.freeze([...rule.values]) } : {}),
        };
        throw new YirSDKValidationError("parameter_required", path, expected);
      }
      continue;
    }
    const value = values[rule.name];
    if (typeof value === "string" && rule.type !== "string" && rule.string_values?.includes(value)) continue;
    const validType = rule.type === "integer" ? typeof value === "number" && Number.isSafeInteger(value)
      : rule.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : rule.type === "string" ? typeof value === "string"
      : rule.type === "boolean" ? typeof value === "boolean" : false;
    if (!validType) {
      throw new YirSDKValidationError("parameter_type", path, { type: rule.type });
    }
    if (typeof value === "number" &&
      ((rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum))) {
      const expected: ParameterExpectation = {
        type: rule.type,
        ...(rule.minimum !== undefined ? { minimum: rule.minimum } : {}),
        ...(rule.maximum !== undefined ? { maximum: rule.maximum } : {}),
      };
      throw new YirSDKValidationError("parameter_range", path, expected);
    }
    if (rule.values && !rule.values.includes(value as string | number | boolean)) {
      throw new YirSDKValidationError("parameter_value", path, {
        values: Object.freeze([...rule.values]),
      });
    }
  }
}

/**
 * Shared Quote/Submit preflight. Without a catalog it checks only the protocol
 * skeleton; model limits, roles, lengths and routing codes are Gateway facts.
 * Fields newer than this SDK are passed through unchanged.
 */
export function validateGeneration(requestedOperation: GenerationOperation, request: unknown, catalog?: ModelContractCatalog): void {
  const body = requireObject(request, "request");
  if (Object.hasOwn(body, "billing_mode") && body.billing_mode !== undefined) {
    if (body.billing_mode !== "actual") throw new YirSDKValidationError("billing_mode_invalid", "billing_mode");
    if (Object.hasOwn(body, "max_cost")) throw new YirSDKValidationError("billing_mode_conflict", "max_cost");
  }
  if (typeof body.model !== "string" || !body.model.trim()) throw new YirSDKValidationError("model_required", "model");
  const input = requireObject(body.input, "input");
  if (typeof input.type !== "string" || !input.type) throw new YirSDKValidationError("input_mode_invalid", "input.type");
  const operation = catalog ? resolveCatalogOperation(catalog, body.model, requestedOperation, input.type) : requestedOperation;
  const optionalVideoPrompt = operation === "generate_video" && input.type === "image";
  if ((input.prompt !== undefined && typeof input.prompt !== "string") ||
      (!optionalVideoPrompt && (typeof input.prompt !== "string" || !input.prompt.trim()))) {
    throw new YirSDKValidationError("prompt_required", "input.prompt");
  }
  // Music parameters are optional; image and video requests send them explicitly.
  const parameters = isAudioOperation(operation) && body.parameters === undefined
    ? {} : requireObject(body.parameters, "parameters");
  if (isAudioOperation(operation)) validateMusicInput(operation, input, parameters, catalog !== undefined);
  if (catalog) validateModelParameters(body.model, operation, input.type, parameters, catalog);
  const contract = catalog ? findModelOperationContract(catalog, body.model, operation, input.type) : undefined;
  const constraint = contract?.input_constraints[input.type];
  if (catalog && optionalVideoPrompt && (input.prompt === undefined || !(input.prompt as string).trim()) && constraint?.prompt_optional !== true) {
    throw new YirSDKValidationError("prompt_required", "input.prompt");
  }
  if (catalog && !constraint) throw new YirSDKValidationError("model_contract_unavailable", "input.type");
  const references = input.references === undefined ? [] : input.references;
  if (!Array.isArray(references) || (input.type === "text" && references.length !== 0) ||
      ((input.type === "image" || input.type === "reference") && references.length === 0) ||
      (constraint && (references.length < constraint.min_references || references.length > constraint.max_references))) {
    throw new YirSDKValidationError("reference_count", "input.references");
  }
  const roles = new Map<string, number>();
  const seenReferences = new Set<string>();
  for (const [index, value] of references.entries()) {
    const path = `input.references.${index}`;
    const reference = requireObject(value, path);
    if (typeof reference.role !== "string" || !reference.role ||
        (constraint && !constraint.allowed_reference_roles.includes(reference.role))) {
      throw new YirSDKValidationError("reference_role_invalid", `${path}.role`);
    }
    roles.set(reference.role, (roles.get(reference.role) ?? 0) + 1);
    const identity = JSON.stringify([reference.role, reference.url ?? null, reference.file_id ?? null]);
    if (seenReferences.has(identity)) throw new YirSDKValidationError("duplicate_reference", "input.references");
    seenReferences.add(identity);
  }
  for (const role of constraint?.required_reference_roles ?? []) {
    if (!roles.has(role)) throw new YirSDKValidationError("reference_role_required", "input.references");
  }
  for (const [role, limit] of Object.entries(constraint?.reference_counts_by_role ?? {})) {
    const count = roles.get(role) ?? 0;
    if (count < limit.minimum || count > limit.maximum) {
      throw new YirSDKValidationError("reference_role_count", "input.references");
    }
  }
  if (constraint?.required_any_reference_roles?.length && !constraint.required_any_reference_roles.some(role => roles.has(role))) {
    throw new YirSDKValidationError("reference_role_required", "input.references");
  }
  const durationRule = contract?.parameters.find(parameter => parameter.name === "duration");
  const duration = parameters.duration ?? durationRule?.default;
  for (const [role, maximum] of Object.entries(constraint?.max_duration_by_reference_role ?? {})) {
    if (roles.has(role) && typeof duration === "number" && duration > maximum) {
      throw new YirSDKValidationError("reference_duration_limit", "parameters.duration");
    }
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

// Protocol rules shared by every music model: lyrics, instrumental and the lyrics optimizer exclude each
// other, and sound effects take no lyrics. n, duration and the accepted switches come from the model
// contract. Without a catalog generate_music may name a sound-effect model, so a missing lyrics source
// is left to the Gateway.
function validateMusicInput(operation: GenerationOperation, input: Record<string, unknown>, parameters: Record<string, unknown>, catalogKnown: boolean): void {
  if (input.type !== "text") throw new YirSDKValidationError("input_mode_invalid", "input.type");
  for (const name of ["instrumental", "lyrics_optimizer"]) {
    if (parameters[name] !== undefined && typeof parameters[name] !== "boolean") {
      throw new YirSDKValidationError("parameter_type", `parameters.${name}`, { type: "boolean" });
    }
  }
  const hasLyrics = input.lyrics !== undefined;
  if (hasLyrics && (typeof input.lyrics !== "string" || !input.lyrics.trim())) {
    throw new YirSDKValidationError("lyrics_invalid", "input.lyrics");
  }
  if (hasLyrics && operation === "generate_sound_effect") throw new YirSDKValidationError("lyrics_not_allowed", "input.lyrics");
  if (parameters.instrumental === true && parameters.lyrics_optimizer === true) {
    throw new YirSDKValidationError("parameter_conflict", "parameters.lyrics_optimizer");
  }
  if (hasLyrics && (parameters.instrumental === true || parameters.lyrics_optimizer === true)) {
    throw new YirSDKValidationError("lyrics_not_allowed", "input.lyrics");
  }
  if (catalogKnown && operation === "generate_music" && !hasLyrics && parameters.instrumental !== true && parameters.lyrics_optimizer !== true) {
    throw new YirSDKValidationError("lyrics_required", "input.lyrics");
  }
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new YirSDKValidationError("object_required", path);
  }
  return value as Record<string, unknown>;
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
 * Provider codes, preferences, limits and fields newer than this SDK are
 * validated by the Gateway; only the value shapes are checked here.
 */
export function normalizeRoutingOverride(
  routing?: RoutingOverride,
): RoutingOverride | undefined {
  if (routing === undefined) return undefined;
  if (routing === null || typeof routing !== "object" || Array.isArray(routing)) {
    throw new YirSDKValidationError("routing_invalid", "routing");
  }
  const { variants: rawVariants, preference, only: rawOnly, fallback, ...newer } = routing;
  if (preference !== undefined && (typeof preference !== "string" || !preference)) {
    throw new YirSDKValidationError("routing_preference_invalid", "routing.preference");
  }
  const only = normalizeProviders(rawOnly, "routing.only");
  let variants: Record<string, string> | undefined;
  if (rawVariants !== undefined) {
    if (!rawVariants || typeof rawVariants !== "object" || Array.isArray(rawVariants) || Object.keys(rawVariants).length === 0 ||
        Object.values(rawVariants).some(variant => typeof variant !== "string" || !variant)) {
      throw new YirSDKValidationError("routing_invalid", "routing.variants");
    }
    variants = Object.fromEntries(Object.entries(rawVariants).sort(([a], [b]) => a.localeCompare(b)));
  }
  if (fallback !== undefined && typeof fallback !== "boolean") {
    throw new YirSDKValidationError("routing_fallback_invalid", "routing.fallback");
  }

  const normalized: RoutingOverride = {
    ...newer,
    ...(variants ? { variants } : {}),
    ...(preference ? { preference } : {}),
    ...(only ? { only } : {}),
    ...(fallback === undefined ? {} : { fallback }),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** Build the portable Yir Standard image request shared by Playground and SDK consumers. */
export function buildImageGenerationRequest(
  input: BuildImageGenerationRequest,
  catalog?: ModelContractCatalog,
): StandardImageGenerationRequest {
  const model = input.model.trim();
  if (!model) throw new YirSDKValidationError("model_required", "model");
  const prompt = input.prompt.trim();
  if (!prompt) throw new YirSDKValidationError("prompt_required", "input.prompt");
  const parameters = input.parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new YirSDKValidationError("parameters_required", "parameters");
  }

  const routing = normalizeRoutingOverride(input.routing);
  const webhookUrl = normalizeWebhookURL(input.webhookUrl);
  const image = input.image;
  if (image !== undefined) {
    const keys = image && typeof image === "object" && !Array.isArray(image) ? Object.keys(image) : [];
    if (keys.length !== 1 || (keys[0] !== "file_id" && keys[0] !== "url")) {
      throw new YirSDKValidationError("image_source_invalid", "input.image");
    }
    const value = (image as Record<string, unknown>)[keys[0]!];
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
  validateGeneration("generate_image", request, catalog);
  return request;
}

/** Build the read-only Quote request from the same normalized image contract. */
export function buildImageQuoteRequest(
  input: BuildImageQuoteRequest,
  catalog?: ModelContractCatalog,
): StandardImageQuoteRequest {
  const { webhook_url: _webhookURL, max_cost: _maxCost, ...request } = buildImageGenerationRequest(input, catalog);
  return request;
}

function normalizeProviders(providers: readonly string[] | undefined, path: string): readonly string[] | undefined {
  if (providers === undefined) return undefined;
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new YirSDKValidationError("routing_provider_count", path);
  }
  const seen = new Set<string>();
  for (const provider of providers) {
    if (typeof provider !== "string" || !provider) throw new YirSDKValidationError("routing_provider_code_invalid", path);
    if (seen.has(provider)) throw new YirSDKValidationError("routing_provider_duplicate", path);
    seen.add(provider);
  }
  return [...providers].sort();
}

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
