package yir

type ParameterRule struct {
	Behavior    string   `json:"behavior"`
	Values      []string `json:"values,omitempty"`
	Reason      string   `json:"reason,omitempty"`
	Description struct {
		Zh string `json:"zh"`
		En string `json:"en"`
	} `json:"description"`
}

// ChannelParameters describes possible behavior, not execution eligibility.
type ChannelParameters struct {
	Provider       string                   `json:"provider"`
	ChannelVariant string                   `json:"channel_variant"`
	Operation      string                   `json:"operation"`
	InputMode      string                   `json:"input_mode"`
	ParameterRules map[string]ParameterRule `json:"parameter_rules"`
}

// ParameterNotice is expected in Quote and actual only in a succeeded Job.
type ParameterNotice struct {
	Name        string `json:"name"`
	Disposition string `json:"disposition"`
	Reason      string `json:"reason"`
	Message     string `json:"message"`
}
