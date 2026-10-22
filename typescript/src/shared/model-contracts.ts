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
  /** Extra string values a numeric parameter accepts, such as duration "auto"; the Gateway enforces their conditions. */
  readonly string_values?: readonly string[];
  readonly default?: ModelParameterValue;
  readonly minimum?: number;
  readonly maximum?: number;
  /** Rendering hint; newer controls may appear and should fall back to a generic input. */
  readonly control: "select" | "aspect_ratio" | "number" | "toggle" | "file" | "text" | (string & {});
  readonly locales: Readonly<Record<string, ModelContractLocale>>;
};

export type ReferenceRole = "first_frame" | "last_frame" | "reference_image" | "reference_video" | "reference_audio" | (string & {});

export type ModelInputConstraint = {
  readonly prompt_optional?: boolean;
  readonly min_references: number;
  readonly max_references: number;
  readonly allowed_reference_roles: readonly ReferenceRole[];
  readonly required_reference_roles?: readonly ReferenceRole[];
  readonly max_duration_by_reference_role?: Readonly<Record<string, number>>;
  readonly reference_counts_by_role?: Readonly<Record<string, { readonly minimum: number; readonly maximum: number }>>;
  readonly required_any_reference_roles?: readonly string[];
  /** Present when reference_image photos may be grouped into named characters with `subject`. */
  readonly subject_references?: SubjectReferenceLimits;
};

/**
 * Photo character reference limits. Requests whose references carry `subject` use these limits;
 * non-empty value lists replace the operation parameter values for that mode.
 */
export type SubjectReferenceLimits = {
  readonly min_images_per_subject: number;
  readonly max_images_per_subject: number;
  /** Maximum subjects with photos. */
  readonly max_subjects: number;
  /**
   * Subjects coexist with ungrouped references and the operation values stay; min/max_references
   * count ungrouped references plus subjects, and role counts apply to ungrouped references only.
   */
  readonly mixed?: boolean;
  /** reference_audio allowed per subject as its voice; absent means subjects take photos only. */
  readonly max_audios_per_subject?: number;
  /** Maximum subjects that have only reference_audio (standalone voices). */
  readonly max_audio_only_subjects?: number;
  readonly resolutions?: readonly string[];
  readonly aspect_ratios?: readonly string[];
  readonly default_aspect_ratio?: string;
  readonly allowed_durations?: readonly number[];
  readonly min_duration_seconds?: number;
  readonly max_duration_seconds?: number;
  readonly allowed_audios?: readonly boolean[];
};

export type ModelOperationContract = {
  readonly operation: "generate_image" | "generate_video" | "generate_music" | "generate_sound_effect" | "generate_speech" | (string & {});
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
