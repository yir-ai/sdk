import type { ModelOperationContract } from "./model-contracts.js";

/** Checks declared request policies without logging, changing inputs or selecting a route. */
export function checkParameterPolicies(
  contract: ModelOperationContract,
  parameters: Readonly<object>,
  only?: readonly string[],
): ParameterNotice[] {
  return contract.parameters.flatMap(parameter => {
    const policy = parameter.policy;
    if (!policy || !Object.hasOwn(parameters, parameter.name) || Reflect.get(parameters, parameter.name) === undefined ||
        (only?.length === 1 && only[0] === policy.only_provider)) return [];
    return [{ name: parameter.name, disposition: "ignored" as const, reason: policy.reason, message: policy.message }];
  });
}

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
  readonly operation: "generate_image" | "generate_video";
  readonly input_mode: "text" | "image" | "reference";
  readonly parameter_rules: Readonly<Record<string, ParameterRule>>;
};

/** Quote notices are expected; only a succeeded Job confirms actual handling. */
export type ParameterNotice = {
  readonly name: string;
  readonly disposition: "ignored";
  readonly reason: string;
  readonly message: string;
};
