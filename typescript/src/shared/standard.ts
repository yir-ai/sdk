import { findModelContract, findModelOperationContract, parameterTypeKnown, type ModelContractCatalog } from "./catalog.js";
import type { ModelOperationContract, ModelParameterContract, ReferenceRole } from "./model-contracts.js";

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
  /**
   * Groups reference_image photos into one named character on models whose input constraint declares
   * `subject_references`; write `@<subject>` in the prompt. When any reference has a subject, all must, unless
   * `subject_references.mixed`; where `max_audios_per_subject` is set, a `reference_audio` with the subject's
   * name is its voice, and a name with only `reference_audio` is a standalone voice; where `max_videos_per_subject`
   * is set, a `reference_video` with a subject is a video character.
   */
  readonly subject?: string;
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

/** Music, sound-effect and text-to-speech input: a prompt plus optional lyrics; no references. */
export type StandardMusicTextInput = {
  readonly type: "text";
  /**
   * Style, mood and scenario of the music, the description of a sound effect, or for
   * text-to-speech models the exact text to read aloud (billed per character). Per-model length limit.
   */
  readonly prompt: string;
  /**
   * Song lyrics, lines separated by \n; structure tags such as [Verse] and [Chorus] are allowed.
   * Only models that accept custom lyrics take this field. Vocal music needs lyrics,
   * parameters.lyrics_optimizer or parameters.instrumental as the model supports; omit it when
   * instrumental or lyrics_optimizer is true. Sound effects and text-to-speech take no lyrics.
   */
  readonly lyrics?: string;
};

/** One source song for a cover: role reference_audio with a URL or uploaded file. */
export type StandardMusicReference = { readonly role: "reference_audio" } & StandardMediaSource;

/**
 * Upload-a-song cover, for music models whose contract declares the reference input mode (Suno):
 * keeps the melody of one source song (at most 8 minutes) and remakes it in the prompt's style.
 * Lyrics follow the text-input rule: input.lyrics, parameters.lyrics_optimizer or parameters.instrumental.
 */
export type StandardMusicReferenceInput = {
  readonly type: "reference";
  /** Style of the cover, for example genre, instruments and vocal. Per-model length limit. */
  readonly prompt: string;
  /** New lyrics sung over the source melody; omit when instrumental or lyrics_optimizer is true. */
  readonly lyrics?: string;
  /** Exactly one source song. */
  readonly references: readonly [StandardMusicReference];
};

/**
 * Optional music, sound-effect and text-to-speech parameters; omitted fields take the model's defaults and
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
  /** Text-to-speech only: a preset voice ID of the model (for example a MiniMax system voice or an ElevenLabs voice ID). Omit for the model default; the voice does not change the price. */
  readonly voice?: string;
  readonly [name: string]: unknown;
};

/** Music, sound-effect or text-to-speech request: one Job delivers the tracks the model makes per request (two for Suno) as audio files behind short-lived links. */
export type StandardMusicGenerationRequest = {
  /** @deprecated Omit for new requests; actual-cost settlement is the default. Retained for legacy callers with the existing validation rules. */
  readonly billing_mode?: "actual";
  /** Optional total Job budget. A more expensive fallback can exceed the remaining budget and fail the Job with YIR_BUDGET_EXCEEDED. Omit for delivery continuity without a per-Job cap, or allow headroom for fallback and prior billed attempts. */
  readonly max_cost?: string;
  readonly model: string;
  readonly input: StandardMusicTextInput | StandardMusicReferenceInput;
  /** Optional for music; omitted parameters take their published defaults. */
  readonly parameters?: StandardMusicParameters;
  readonly routing?: RoutingOverride;
  readonly webhook_url?: string;
};

export type StandardMusicQuoteRequest = Omit<
  StandardMusicGenerationRequest,
  "webhook_url" | "max_cost"
>;

/** One image of a single object for image-to-3D. */
export type Standard3DImageReference = { readonly role: "reference_image" } & StandardMediaSource;

/** One view of the same object for multiview-to-3D. */
export type Standard3DViewReference = { readonly role: "front_view" | "left_view" | "back_view" | "right_view" } & StandardMediaSource;

/** Text-to-3D: a description of the object to model. Per-model length limit. */
export type Standard3DTextInput = {
  readonly type: "text";
  readonly prompt: string;
};

/** Image-to-3D from exactly one picture of a single object; takes no prompt. */
export type Standard3DImageInput = {
  readonly type: "image";
  readonly references: readonly [Standard3DImageReference];
};

/**
 * Image-to-3D from several views of the same object, only for models whose contract lists the multiview
 * input mode: one front_view plus at least one of left_view, back_view and right_view, each at most once.
 * Takes no prompt and may cost more (see the quote).
 */
export type Standard3DMultiviewInput = {
  readonly type: "multiview";
  readonly references: readonly Standard3DViewReference[];
};

/**
 * Optional 3D parameters; omitted fields take the model defaults and a model accepts only the values its
 * contract declares. Every Job delivers one glb file.
 */
export type Standard3DParameters = {
  /** none returns an untextured mesh; standard and hd bake textures (hd is higher resolution where supported). */
  readonly texture?: "none" | "standard" | "hd" | (string & {});
  /** PBR maps (metallic, roughness, normal) in addition to base color. Requires a texture; some models charge extra. */
  readonly pbr?: boolean;
  /** Target face count; range and default come from the model contract. Some models charge extra for a custom count. */
  readonly face_limit?: number;
  /** Mesh face type; quad is a quad-dominant remesh where supported. The glb file stores triangles. */
  readonly topology?: "triangle" | "quad" | (string & {});
  /** One model per Job. */
  readonly n?: 1;
};

/** 3D request: one Job delivers one glb model (media type model/gltf-binary) behind a short-lived link. */
export type Standard3DGenerationRequest = {
  /** @deprecated Omit for new requests; actual-cost settlement is the default. Retained for legacy callers with the existing validation rules. */
  readonly billing_mode?: "actual";
  /** Optional total Job budget. A more expensive fallback can exceed the remaining budget and fail the Job with YIR_BUDGET_EXCEEDED. Omit for delivery continuity without a per-Job cap, or allow headroom for fallback and prior billed attempts. */
  readonly max_cost?: string;
  readonly model: string;
  readonly input: Standard3DTextInput | Standard3DImageInput | Standard3DMultiviewInput;
  /** Optional; omitted parameters take the model defaults. */
  readonly parameters?: Standard3DParameters;
  readonly routing?: RoutingOverride;
  readonly webhook_url?: string;
};

export type Standard3DQuoteRequest = Omit<
  Standard3DGenerationRequest,
  "webhook_url" | "max_cost"
>;

/** Generation operations known to this SDK release. */
export type GenerationOperation = "generate_image" | "generate_video" | "generate_music" | "generate_sound_effect" | "generate_speech" | "generate_3d";

const isAudioOperation = (operation: string) =>
  operation === "generate_music" || operation === "generate_sound_effect" || operation === "generate_speech";

/** Shape of a preset text-to-speech voice ID; whether the voice exists is a Gateway and provider fact. */
const speechVoicePattern = /^[A-Za-z0-9][A-Za-z0-9 _().\-]{0,127}$/;

/** The music methods also serve sound-effect and text-to-speech models: generate_music resolves to the operation the catalog declares. */
function resolveCatalogOperation(catalog: ModelContractCatalog, model: string, operation: GenerationOperation, inputMode: string): GenerationOperation {
  if (operation !== "generate_music" || findModelOperationContract(catalog, model, operation, inputMode)) return operation;
  for (const audio of ["generate_sound_effect", "generate_speech"] as const) {
    if (findModelOperationContract(catalog, model, audio, inputMode)) return audio;
  }
  return operation;
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
  subjectReferences = false,
): void {
  if (!catalog) throw new YirSDKValidationError("model_contract_required", "catalog");
  const found = findModelOperationContract(catalog, model, resolveCatalogOperation(catalog, model, operation, inputMode), inputMode);
  if (!found) throw new YirSDKValidationError("model_contract_unavailable", "model");
  const contract = subjectReferences ? subjectModeContract(found, inputMode) : found;
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
  // 3D takes text, one image or several views; image and multiview inputs take no prompt.
  if (operation === "generate_3d" && input.type !== "text") {
    if (input.type !== "image" && input.type !== "multiview") throw new YirSDKValidationError("input_mode_invalid", "input.type");
    if (input.prompt !== undefined) throw new YirSDKValidationError("prompt_not_allowed", "input.prompt");
  } else if ((input.prompt !== undefined && typeof input.prompt !== "string") ||
      (!optionalVideoPrompt && (typeof input.prompt !== "string" || !input.prompt.trim()))) {
    throw new YirSDKValidationError("prompt_required", "input.prompt");
  }
  // Audio and 3D parameters are optional; image and video requests send them explicitly.
  const parameters = (isAudioOperation(operation) || operation === "generate_3d") && body.parameters === undefined
    ? {} : requireObject(body.parameters, "parameters");
  // A cover is offered only by music models that declare the reference input mode, and each 3D model
  // lists the input modes it takes.
  if (catalog && ((isAudioOperation(operation) && input.type === "reference") || operation === "generate_3d") &&
      findModelContract(catalog, body.model) && !findModelOperationContract(catalog, body.model, operation, input.type)) {
    throw new YirSDKValidationError("input_mode_invalid", "input.type");
  }
  if (isAudioOperation(operation)) validateMusicInput(operation, input, parameters, catalog !== undefined);
  const subjects = validateReferenceSubjects(input);
  const found = catalog ? findModelOperationContract(catalog, body.model, operation, input.type) : undefined;
  if (operation === "generate_3d") validate3DInput(input, parameters, found);
  if (subjects && found && !found.input_constraints[input.type]?.subject_references) {
    throw new YirSDKValidationError("reference_subject_unsupported", "input.references");
  }
  if (catalog) validateModelParameters(body.model, operation, input.type, parameters, catalog, subjects !== undefined);
  const contract = found && subjects ? subjectModeContract(found, input.type) : found;
  const constraint = contract?.input_constraints[input.type];
  const subjectLimits = subjects ? constraint?.subject_references : undefined;
  if (subjects && subjectLimits) {
    if ((!subjectLimits.mixed && subjects.ungrouped > 0) ||
        (!subjectLimits.max_audios_per_subject && [...subjects.groups.values()].some(group => group.audios > 0)) ||
        (!subjectLimits.max_videos_per_subject && [...subjects.groups.values()].some(group => group.videos > 0))) {
      throw new YirSDKValidationError("reference_subject_invalid", "input.references");
    }
    const groups = [...subjects.groups.values()];
    const videoSubjects = groups.filter(group => group.videos > 0);
    const photoSubjects = groups.filter(group => group.videos === 0 && group.images > 0);
    if (photoSubjects.length > subjectLimits.max_subjects ||
        videoSubjects.length > (subjectLimits.max_video_subjects ?? 0) ||
        videoSubjects.some(group => group.images > 0 || group.videos > (subjectLimits.max_videos_per_subject ?? 0)) ||
        groups.length - photoSubjects.length - videoSubjects.length > (subjectLimits.max_audio_only_subjects ?? 0) ||
        groups.some(group => group.audios > (subjectLimits.max_audios_per_subject ?? 0)) ||
        photoSubjects.some(group => group.images < subjectLimits.min_images_per_subject || group.images > subjectLimits.max_images_per_subject)) {
      throw new YirSDKValidationError("reference_subject_count", "input.references");
    }
  }
  // Mixed subject mode counts ungrouped references plus subjects; role counts use ungrouped references only.
  const mixed = subjects !== undefined && subjectLimits?.mixed === true;
  if (catalog && optionalVideoPrompt && (input.prompt === undefined || !(input.prompt as string).trim()) && constraint?.prompt_optional !== true) {
    throw new YirSDKValidationError("prompt_required", "input.prompt");
  }
  if (catalog && !constraint) throw new YirSDKValidationError("model_contract_unavailable", "input.type");
  const references = input.references === undefined ? [] : input.references;
  if (!Array.isArray(references) || (input.type === "text" && references.length !== 0) ||
      ((input.type === "image" || input.type === "reference" || input.type === "multiview") && references.length === 0) ||
      (constraint && (referenceItems(references, mixed) < constraint.min_references || referenceItems(references, mixed) > constraint.max_references))) {
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
    if (!mixed || reference.subject === undefined) roles.set(reference.role, (roles.get(reference.role) ?? 0) + 1);
    const identity = JSON.stringify([reference.role, reference.url ?? null, reference.file_id ?? null, reference.subject ?? null]);
    // Keyframes form an ordered sequence; repeating one (returning to the same shot) is intentional.
    if (reference.role !== "keyframe" && seenReferences.has(identity)) throw new YirSDKValidationError("duplicate_reference", "input.references");
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
// other, and sound effects take no lyrics. Only music takes a reference input (a cover of one source
// song). Text-to-speech reads input.prompt aloud and takes only n and voice. n, duration and the accepted switches come from the model contract. Without a catalog
// generate_music may name a sound-effect or text-to-speech model, so a missing lyrics source and a voice
// on a music model are left to the Gateway.
function validateMusicInput(operation: GenerationOperation, input: Record<string, unknown>, parameters: Record<string, unknown>, catalogKnown: boolean): void {
  if (input.type !== "text" && !(input.type === "reference" && operation === "generate_music")) {
    throw new YirSDKValidationError("input_mode_invalid", "input.type");
  }
  for (const name of ["instrumental", "lyrics_optimizer"]) {
    if (parameters[name] !== undefined && typeof parameters[name] !== "boolean") {
      throw new YirSDKValidationError("parameter_type", `parameters.${name}`, { type: "boolean" });
    }
  }
  if (parameters.voice !== undefined) {
    if (typeof parameters.voice !== "string") throw new YirSDKValidationError("parameter_type", "parameters.voice", { type: "string" });
    if (!speechVoicePattern.test(parameters.voice)) throw new YirSDKValidationError("voice_invalid", "parameters.voice");
  }
  const hasLyrics = input.lyrics !== undefined;
  if (hasLyrics && (typeof input.lyrics !== "string" || !input.lyrics.trim())) {
    throw new YirSDKValidationError("lyrics_invalid", "input.lyrics");
  }
  if (operation === "generate_speech") {
    if (hasLyrics) throw new YirSDKValidationError("lyrics_not_allowed", "input.lyrics");
    for (const name of ["duration", "instrumental", "lyrics_optimizer"]) {
      if (Object.hasOwn(parameters, name)) {
        throw new YirSDKValidationError("parameter_unknown", `parameters.${name}`, { allowed_parameters: Object.freeze(["n", "voice"]) });
      }
    }
    return;
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

// Protocol rules shared by every 3D model (input.type is already text, image or multiview): one image or
// several views of one object, and pbr needs a texture. Allowed values, defaults and face_limit ranges come from the model contract.
function validate3DInput(input: Record<string, unknown>, parameters: Record<string, unknown>, contract?: ModelOperationContract): void {
  for (const name of ["texture", "topology"]) {
    if (parameters[name] !== undefined && typeof parameters[name] !== "string") {
      throw new YirSDKValidationError("parameter_type", `parameters.${name}`, { type: "string" });
    }
  }
  if (parameters.pbr !== undefined && typeof parameters.pbr !== "boolean") {
    throw new YirSDKValidationError("parameter_type", "parameters.pbr", { type: "boolean" });
  }
  for (const name of ["face_limit", "n"]) {
    const value = parameters[name];
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)) {
      throw new YirSDKValidationError("parameter_type", `parameters.${name}`, { type: "integer" });
    }
  }
  const texture = parameters.texture ?? contract?.parameters.find(rule => rule.name === "texture")?.default;
  if (texture === "none" && parameters.pbr === true) throw new YirSDKValidationError("parameter_conflict", "parameters.pbr");
  const references = Array.isArray(input.references) ? input.references : [];
  if ((input.type === "image" && references.length !== 1) || (input.type === "multiview" && (references.length < 2 || references.length > 4))) {
    throw new YirSDKValidationError("reference_count", "input.references");
  }
  if (input.type === "multiview") {
    const roles = references.map(reference => (reference as { role?: unknown } | null)?.role);
    if (!roles.includes("front_view")) throw new YirSDKValidationError("reference_role_required", "input.references");
    if (new Set(roles).size !== roles.length) throw new YirSDKValidationError("reference_role_count", "input.references");
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

const SUBJECT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

type SubjectSummary = { readonly groups: Map<string, { images: number; videos: number; audios: number }>; readonly ungrouped: number };

// Counts photos and voices per subject. Subjects go on reference_image or reference_audio with a valid
// name; whether ungrouped references and voices may join them is checked against the catalog when present.
function validateReferenceSubjects(input: Record<string, unknown>): SubjectSummary | undefined {
  const references = Array.isArray(input.references) ? input.references : [];
  if (!references.some(reference => typeof reference === "object" && reference !== null && "subject" in reference)) return undefined;
  const groups = new Map<string, { images: number; videos: number; audios: number }>();
  let ungrouped = 0;
  for (const [index, value] of references.entries()) {
    const reference = requireObject(value, `input.references.${index}`);
    if (!("subject" in reference)) {
      ungrouped++;
      continue;
    }
    if (input.type !== "reference" || (reference.role !== "reference_image" && reference.role !== "reference_audio" && reference.role !== "reference_video") ||
        typeof reference.subject !== "string" || !SUBJECT_NAME.test(reference.subject)) {
      throw new YirSDKValidationError("reference_subject_invalid", `input.references.${index}.subject`);
    }
    const group = groups.get(reference.subject) ?? { images: 0, videos: 0, audios: 0 };
    if (reference.role === "reference_audio") group.audios++;
    else if (reference.role === "reference_video") group.videos++;
    else group.images++;
    groups.set(reference.subject, group);
  }
  return { groups, ungrouped };
}

// Items counted against min/max_references: every reference, or in mixed subject mode the
// ungrouped references plus one per subject.
function referenceItems(references: readonly unknown[], mixed: boolean): number {
  if (!mixed) return references.length;
  const subjects = new Set<string>();
  let items = 0;
  for (const value of references) {
    const subject = typeof value === "object" && value !== null ? (value as { subject?: unknown }).subject : undefined;
    if (typeof subject !== "string") items++;
    else if (!subjects.has(subject)) {
      subjects.add(subject);
      items++;
    }
  }
  return items;
}

// The subject (photo character) mode of an operation: subject limits replace reference counts and roles,
// and its declared value lists replace the matching parameter values. Mixed subjects keep the operation.
function subjectModeContract(contract: ModelOperationContract, inputMode: string): ModelOperationContract {
  const constraint = contract.input_constraints[inputMode];
  const limits = constraint?.subject_references;
  if (!constraint || !limits || limits.mixed) return contract;
  const durations = limits.allowed_durations?.length || limits.min_duration_seconds || limits.max_duration_seconds;
  const parameters = contract.parameters.map(parameter => {
    switch (parameter.name) {
      case "resolution":
        return limits.resolutions?.length ? { ...parameter, values: limits.resolutions } : parameter;
      case "aspect_ratio":
        return {
          ...parameter,
          ...(limits.aspect_ratios?.length ? { values: limits.aspect_ratios } : {}),
          ...(limits.default_aspect_ratio ? { default: limits.default_aspect_ratio } : {}),
        };
      case "duration": {
        if (!durations) return parameter;
        const { values: _values, string_values: _strings, minimum: _minimum, maximum: _maximum, ...rest } = parameter;
        return {
          ...rest,
          ...(limits.allowed_durations?.length ? { values: limits.allowed_durations } : {}),
          ...(limits.min_duration_seconds ? { minimum: limits.min_duration_seconds } : {}),
          ...(limits.max_duration_seconds ? { maximum: limits.max_duration_seconds } : {}),
        };
      }
      case "generate_audio":
        return limits.allowed_audios?.length ? { ...parameter, values: limits.allowed_audios } : parameter;
      default:
        return parameter;
    }
  });
  return {
    ...contract,
    parameters,
    input_constraints: {
      ...contract.input_constraints,
      [inputMode]: {
        ...(constraint.prompt_optional !== undefined ? { prompt_optional: constraint.prompt_optional } : {}),
        min_references: limits.min_images_per_subject,
        max_references: limits.max_images_per_subject * limits.max_subjects,
        allowed_reference_roles: ["reference_image"],
        required_reference_roles: ["reference_image"],
        subject_references: limits,
      },
    },
  };
}
