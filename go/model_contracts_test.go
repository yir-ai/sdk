package yir

import "testing"

func TestGeneratedModelContractsExposeTypedStaticParameters(t *testing.T) {
	contracts := ListModelContracts()
	if len(contracts) == 0 {
		t.Fatal("generated model contracts are empty")
	}
	operation, ok := GetModelOperationContract("gpt-image-2", "generate_image", "text")
	if !ok {
		t.Fatal("GPT Image 2 text contract is missing")
	}
	resolution := findParameter(operation.Parameters, "resolution")
	if resolution == nil || len(resolution.Values) != 3 || resolution.Values[2] != "4K" {
		t.Fatalf("unexpected GPT Image 2 resolutions: %#v", resolution)
	}
	outputs := findParameter(operation.Parameters, "n")
	if outputs == nil || len(outputs.Values) != 1 || outputs.Values[0] != 1 {
		t.Fatalf("unexpected GPT Image 2 output counts: %#v", outputs)
	}
	if _, ok := outputs.Values[0].(int); !ok {
		t.Fatalf("integer parameter decoded as %T", outputs.Values[0])
	}
	if resolution.Locales["zh-CN"].Label != "分辨率" {
		t.Fatalf("unexpected Chinese label: %q", resolution.Locales["zh-CN"].Label)
	}
}

func TestReturnedModelContractsCannotMutateBundledCatalog(t *testing.T) {
	first, ok := GetModelContract("openai/gpt-image-2")
	if !ok || len(first.Aliases) == 0 || len(first.Operations) == 0 ||
		len(first.Operations[0].Parameters) == 0 || len(first.Operations[0].Parameters[0].Values) == 0 {
		t.Fatal("GPT Image 2 contract is incomplete")
	}
	first.ID = "mutated"
	first.Aliases[0] = "mutated"
	first.Locales["en"] = ModelContractLocale{Label: "mutated"}
	first.Operations[0].Parameters[0].Values[0] = "mutated"
	duration, ok := GetModelOperationContract("bytedance/seedance-2.0", "generate_video", "text")
	if !ok {
		t.Fatal("Seedance 2.0 text contract is missing")
	}
	durationParameter := findParameter(duration.Parameters, "duration")
	if durationParameter == nil || durationParameter.Minimum == nil || durationParameter.Maximum == nil {
		t.Fatal("Seedance 2.0 duration range is missing")
	}
	*durationParameter.Minimum = 99
	*durationParameter.Maximum = 99

	second, ok := GetModelContract("openai/gpt-image-2")
	if !ok || second.ID == "mutated" || second.Aliases[0] == "mutated" ||
		second.Locales["en"].Label == "mutated" ||
		second.Operations[0].Parameters[0].Values[0] == "mutated" {
		t.Fatal("callers can mutate the bundled model contract catalog")
	}
	secondDuration, ok := GetModelOperationContract("bytedance/seedance-2.0", "generate_video", "text")
	if !ok {
		t.Fatal("Seedance 2.0 text contract is missing after mutation")
	}
	secondDurationParameter := findParameter(secondDuration.Parameters, "duration")
	if secondDurationParameter == nil || secondDurationParameter.Minimum == nil ||
		secondDurationParameter.Maximum == nil || *secondDurationParameter.Minimum == 99 ||
		*secondDurationParameter.Maximum == 99 {
		t.Fatal("callers can mutate bundled numeric parameter ranges")
	}
	if _, ok := GetModelContract("future/model"); ok {
		t.Fatal("unknown model received a false static contract")
	}
}

func findParameter(parameters []ModelParameterContract, name string) *ModelParameterContract {
	for index := range parameters {
		if parameters[index].Name == name {
			return &parameters[index]
		}
	}
	return nil
}
