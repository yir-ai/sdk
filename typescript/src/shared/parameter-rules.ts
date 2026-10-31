/** Possible channel behavior; availability and actual handling remain server facts. */
export type ParameterRule = {
  readonly behavior: "supported" | "ignored" | "rejected";
  readonly values?: readonly string[];
  readonly reason?: string;
  readonly description: {readonly zh: string; readonly en: string};
};

export type ChannelParameters = {
  readonly provider: string;
  readonly channel_variant: string;
  readonly operation: "generate_image" | "generate_video" | "generate_music" | "generate_sound_effect" | "generate_speech" | "generate_3d";
  readonly input_mode: "text" | "image" | "reference" | "multiview";
  readonly parameter_rules: Readonly<Record<string, ParameterRule>>;
};

/**
 * Quote notices are expected; only a succeeded Job confirms actual handling.
 * `exceeded` marks a delivered result that exceeds the request (extra outputs trimmed to n,
 * a higher resolution, or audio although generate_audio is false), charged no more than the quote.
 */
export type ParameterNotice = {
  readonly name: string;
  readonly disposition: "ignored" | "exceeded";
  readonly reason: string;
  readonly message: string;
};
