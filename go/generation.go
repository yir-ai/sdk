package yir

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// GenerationRequest is the common demand used for Quote and Submit.
// The endpoint selects image, video or music generation; provider fields are not accepted.
// Music, sound-effect and text-to-speech parameters (n, duration, instrumental,
// lyrics_optimizer, voice, as the model contract declares) are optional; nil
// Parameters are sent as an empty object. Length-priced models take
// parameters["duration"] in seconds; text-to-speech models take
// parameters["voice"], a preset voice ID of the model.
type GenerationRequest struct {
	// Deprecated: Omit for new requests; actual-cost settlement is the default.
	// Retained for legacy callers with the existing validation rules.
	BillingMode string          `json:"billing_mode,omitempty"`
	Model       string          `json:"model"`
	Input       GenerationInput `json:"input"`
	Parameters  map[string]any  `json:"parameters"`
	Routing     *Routing        `json:"routing,omitempty"`
	// Extra carries top-level request fields newer than this SDK; the Gateway
	// validates them. Fields this SDK models (see reservedRequestFields) are
	// rejected by validation and never sent from Extra. Unmarshal restores it.
	Extra map[string]any `json:"-"`
}

// reservedRequestFields are the top-level fields GenerationRequest and SubmitRequest model.
var reservedRequestFields = map[string]bool{"billing_mode": true, "model": true, "input": true, "parameters": true,
	"routing": true, "max_cost": true, "webhook_url": true}

func (r GenerationRequest) MarshalJSON() ([]byte, error) {
	type plain GenerationRequest
	return marshalWithExtra(plain(r), r.Extra)
}

func (r *GenerationRequest) UnmarshalJSON(data []byte) error {
	type plain GenerationRequest
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	extra, err := unmarshalExtra(data)
	*r = GenerationRequest(value)
	r.Extra = extra
	return err
}

func marshalWithExtra(value any, extra map[string]any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil || len(extra) == 0 {
		return data, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	for key, item := range extra {
		if reservedRequestFields[key] {
			continue
		}
		if fields[key], err = json.Marshal(item); err != nil {
			return nil, err
		}
	}
	return json.Marshal(fields)
}

// unmarshalExtra keeps unmodeled top-level fields so a persisted request round-trips.
func unmarshalExtra(data []byte) (map[string]any, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	var extra map[string]any
	for key, raw := range fields {
		if reservedRequestFields[key] {
			continue
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		var value any
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		if extra == nil {
			extra = make(map[string]any)
		}
		extra[key] = value
	}
	return extra, nil
}

type GenerationInput struct {
	Type       string      `json:"type"`
	Prompt     string      `json:"prompt"`
	References []Reference `json:"references,omitempty"`
	// Lyrics is music only: song lyrics, lines separated by \n, with optional
	// structure tags such as [Verse]. Only models that accept custom lyrics take
	// it; vocal music needs lyrics, lyrics_optimizer or instrumental as the
	// model supports. Omit it when instrumental or lyrics_optimizer is true,
	// and for sound effects.
	Lyrics string `json:"lyrics,omitempty"`
}

// Reference preserves its position and explicit media role. Role names are
// model contract data; the Gateway decides which roles and sources it accepts.
type Reference struct {
	Role string `json:"role"`
	// URL is a public HTTPS URL that Yir imports at submission (up to 100 MiB);
	// use FileID for larger media. Set exactly one of URL or FileID.
	URL    string `json:"url,omitempty"`
	FileID string `json:"file_id,omitempty"`
	// Subject groups reference_image photos into one named character on models
	// whose input constraint declares SubjectReferences; write @Subject in the
	// prompt. When any reference has a subject, all must be subject photos
	// unless the constraint's subject_references is mixed; there a
	// reference_audio with a subject is that subject's voice (or a standalone
	// voice when the subject has no photos), and where max_videos_per_subject
	// is declared a reference_video with a subject is a video character.
	Subject string `json:"subject,omitempty"`
}

// Routing preferences known to this SDK release. Routing.Preference is a
// plain string and the Gateway validates it, so newer values need no release.
const (
	// RoutingPreferenceCost orders channels by ascending price. It is the
	// Gateway default when Preference is empty.
	RoutingPreferenceCost = "cost"
	// RoutingPreferenceSpeed orders channels by ascending observed upstream
	// latency; channels with too few samples follow in price order.
	RoutingPreferenceSpeed = "speed"
)

// Routing fidelity floors known to this SDK release. Routing.Fidelity is a
// plain string and the Gateway validates it.
const (
	// RoutingFidelityOriginal uses only routes verified as untouched vendor API
	// output, plus the model's official channel.
	RoutingFidelityOriginal = "original"
	// RoutingFidelityGenuine excludes routes known to upscale or otherwise alter
	// the output. It is the Gateway default when Fidelity and the routing
	// profile leave it unset.
	RoutingFidelityGenuine = "genuine"
	// RoutingFidelityAny does not restrict routes; cheapest.
	RoutingFidelityAny = "any"
)

type Routing struct {
	Only     []string          `json:"only,omitempty"`
	Variants map[string]string `json:"variants,omitempty"`
	// Preference is one of the RoutingPreference constants; empty uses the
	// Gateway default (cost).
	Preference string `json:"preference,omitempty"`
	Fallback   *bool  `json:"fallback,omitempty"`
	// Fidelity is one of the RoutingFidelity constants; empty uses the routing
	// profile default (genuine). When every route is excluded the request fails
	// with ErrCodeFidelityExcluded.
	Fidelity string `json:"fidelity,omitempty"`
	// Accelerate controls route acceleration; nil uses the routing profile
	// default (on). When an image attempt stays unresolved upstream well past
	// the channel's usual completion time and another eligible route remains,
	// the Gateway cuts it off and retries on the next route. Requires fallback.
	// Set false to always wait for the first channel.
	Accelerate *bool `json:"accelerate,omitempty"`
}

// ValidateGenerationWithCatalog checks current caller-supplied model rules and
// rejects models, operations and input modes the catalog does not describe.
// Clients configured with ModelContracts instead leave those to the Gateway.
// It does not determine current price, supply, media usage or authorization.
func ValidateGenerationWithCatalog(operation string, request GenerationRequest, catalog ModelContractCatalog) error {
	model, ok := findContractInCatalog(catalog, request.Model)
	if !ok {
		return &ParameterError{"model", "model_contract_unavailable"}
	}
	var contract *ModelOperationContract
	for _, wanted := range catalogOperations(operation) {
		for i := range model.Operations {
			candidate := &model.Operations[i]
			if contract == nil && candidate.Operation == wanted && containsString(candidate.InputModes, request.Input.Type) {
				contract = candidate
			}
		}
	}
	if contract == nil {
		return &ParameterError{"input.type", "operation_contract_unavailable"}
	}
	return validateGenerationWithContract(contract.Operation, request, contract)
}

// catalogOperations lists the contract operations a request operation may
// resolve to: the music methods also serve sound-effect and text-to-speech models.
func catalogOperations(operation string) []string {
	if operation == "generate_music" {
		return []string{"generate_music", "generate_sound_effect", "generate_speech"}
	}
	return []string{operation}
}

func isAudioOperation(operation string) bool {
	return operation == "generate_music" || operation == "generate_sound_effect" || operation == "generate_speech"
}

// speechVoicePattern is the shape of a preset voice ID; whether the voice
// exists is decided by the Gateway and the provider.
var speechVoicePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 _().\-]{0,127}$`)

// ValidateGenerationProtocol checks only stable request structure. New models
// are left for the Gateway unless the caller provides a current catalog.
func ValidateGenerationProtocol(operation string, request GenerationRequest) error {
	return validateGenerationWithContract(operation, request, nil)
}

func validateGenerationWithContract(operation string, request GenerationRequest, contract *ModelOperationContract) error {
	if request.BillingMode != "" {
		if request.BillingMode != "actual" {
			return &ParameterError{"billing_mode", "invalid_value"}
		}
	}
	if strings.TrimSpace(request.Model) == "" {
		return &ParameterError{"model", "model_required"}
	}
	if operation != "generate_image" && operation != "generate_video" && !isAudioOperation(operation) {
		return &ParameterError{"operation", "invalid_operation"}
	}
	if request.Input.Type == "" {
		return &ParameterError{"input.type", "input_mode_invalid"}
	}
	if strings.TrimSpace(request.Input.Prompt) == "" && (operation != "generate_video" || request.Input.Type != "image") {
		return &ParameterError{"input.prompt", "required_parameter"}
	}
	for key := range request.Extra {
		if reservedRequestFields[key] {
			return &ParameterError{"extra." + key, "reserved_field"}
		}
	}
	if isAudioOperation(operation) {
		if err := validateMusicInput(operation, request, contract != nil); err != nil {
			return err
		}
	} else if request.Input.Lyrics != "" {
		return &ParameterError{"input.lyrics", "not_allowed"}
	}
	var constraint *ModelInputConstraint
	if contract != nil {
		declared, ok := contract.InputConstraints[request.Input.Type]
		if !ok {
			return &ParameterError{"input.type", "input_contract_unavailable"}
		}
		constraint = &declared
	}
	constraint, contract, subjectErr := validateSubjectReferences(request, constraint, contract)
	if subjectErr != nil {
		return subjectErr
	}
	if constraint != nil && strings.TrimSpace(request.Input.Prompt) == "" && !constraint.PromptOptional {
		return &ParameterError{"input.prompt", "required_parameter"}
	}
	count := len(request.Input.References)
	// Mixed subject mode counts ungrouped references plus subjects; role counts use ungrouped references only.
	mixed := constraint != nil && constraint.SubjectReferences != nil && constraint.SubjectReferences.Mixed
	items := count
	if mixed {
		subjects := make(map[string]bool)
		items = 0
		for _, reference := range request.Input.References {
			if reference.Subject == "" {
				items++
			} else if !subjects[reference.Subject] {
				subjects[reference.Subject] = true
				items++
			}
		}
	}
	if request.Input.Type == "text" && count != 0 || (request.Input.Type == "image" || request.Input.Type == "reference") && count == 0 ||
		constraint != nil && (items < constraint.MinReferences || items > constraint.MaxReferences) {
		return &ParameterError{"input.references", "invalid_reference_count"}
	}
	roles := make(map[string]int)
	seenReferences := make(map[Reference]bool)
	for i, reference := range request.Input.References {
		path := fmt.Sprintf("input.references[%d]", i)
		// Keyframes form an ordered sequence; repeating one (returning to the same shot) is intentional.
		if reference.Role != "keyframe" && seenReferences[reference] {
			return &ParameterError{"input.references", "duplicate_reference"}
		}
		seenReferences[reference] = true
		if reference.Role == "" || constraint != nil && !containsString(constraint.AllowedReferenceRoles, reference.Role) {
			return &ParameterError{path + ".role", "invalid_reference_role"}
		}
		if !mixed || reference.Subject == "" {
			roles[reference.Role]++
		}
	}
	if contract != nil {
		if err := validateParameters(contract.Parameters, request.Parameters); err != nil {
			return err
		}
	}
	if constraint != nil {
		for _, required := range constraint.RequiredReferenceRoles {
			if roles[required] == 0 {
				return &ParameterError{"input.references", "required_reference_role"}
			}
		}
		for role, limit := range constraint.ReferenceCountsByRole {
			if roles[role] < limit.Minimum || roles[role] > limit.Maximum {
				return &ParameterError{"input.references", "invalid_reference_role_count"}
			}
		}
		if len(constraint.RequiredAnyReferenceRoles) > 0 {
			found := false
			for _, role := range constraint.RequiredAnyReferenceRoles {
				found = found || roles[role] > 0
			}
			if !found {
				return &ParameterError{"input.references", "required_reference_role"}
			}
		}
		var duration any = request.Parameters["duration"]
		if duration == nil {
			for _, parameter := range contract.Parameters {
				if parameter.Name == "duration" {
					duration = parameter.Default
				}
			}
		}
		normalizedDuration, _ := normalizeParameter(duration)
		seconds, hasDuration := parameterInteger(normalizedDuration)
		for role, maximum := range constraint.MaxDurationByReferenceRole {
			if roles[role] > 0 && hasDuration && seconds.Cmp(big.NewInt(int64(maximum))) > 0 {
				return &ParameterError{"parameters.duration", "reference_duration_limit"}
			}
		}
	}
	return validateRouting(request.Routing)
}

// validateMusicInput applies the protocol rules shared by every music model:
// lyrics, instrumental and the lyrics optimizer exclude each other, and sound
// effects take no lyrics. Text-to-speech reads input.prompt aloud and takes only
// n and voice. n, duration and the accepted switches come from the model
// contract. Without a contract generate_music may name a sound-effect or
// text-to-speech model, so a missing lyrics source and a voice on a music
// model are left to the Gateway.
func validateMusicInput(operation string, request GenerationRequest, contractKnown bool) error {
	if request.Input.Type != "text" {
		return &ParameterError{"input.type", "input_mode_invalid"}
	}
	flags := make(map[string]bool, 2)
	for _, name := range []string{"instrumental", "lyrics_optimizer"} {
		value, present := request.Parameters[name]
		if !present || value == nil {
			continue
		}
		flag, ok := value.(bool)
		if !ok {
			return &ParameterError{"parameters." + name, "invalid_type"}
		}
		flags[name] = flag
	}
	if value, present := request.Parameters["voice"]; present && value != nil {
		voice, ok := value.(string)
		if !ok {
			return &ParameterError{"parameters.voice", "invalid_type"}
		}
		if !speechVoicePattern.MatchString(voice) {
			return &ParameterError{"parameters.voice", "invalid_value"}
		}
	}
	hasLyrics := request.Input.Lyrics != ""
	if operation == "generate_speech" {
		if hasLyrics {
			return &ParameterError{"input.lyrics", "not_allowed"}
		}
		for _, name := range []string{"duration", "instrumental", "lyrics_optimizer"} {
			if _, present := request.Parameters[name]; present {
				return &ParameterError{"parameters." + name, "unknown_parameter"}
			}
		}
		return nil
	}
	switch {
	case hasLyrics && strings.TrimSpace(request.Input.Lyrics) == "":
		return &ParameterError{"input.lyrics", "invalid_value"}
	case hasLyrics && operation == "generate_sound_effect":
		return &ParameterError{"input.lyrics", "not_allowed"}
	case flags["instrumental"] && flags["lyrics_optimizer"]:
		return &ParameterError{"parameters.lyrics_optimizer", "parameter_conflict"}
	case hasLyrics && (flags["instrumental"] || flags["lyrics_optimizer"]):
		return &ParameterError{"input.lyrics", "not_allowed"}
	case contractKnown && operation == "generate_music" && !hasLyrics && !flags["instrumental"] && !flags["lyrics_optimizer"]:
		return &ParameterError{"input.lyrics", "required_parameter"}
	}
	return nil
}

func findContractInCatalog(catalog ModelContractCatalog, model string) (StaticModelContract, bool) {
	for _, contract := range catalog.Models {
		if contract.ID == model || containsString(contract.Aliases, model) {
			return contract, true
		}
	}
	return StaticModelContract{}, false
}

// validateRouting checks value shapes only; provider codes, preferences and
// limits are Gateway facts so newer values do not need an SDK release.
func validateRouting(routing *Routing) error {
	if routing == nil {
		return nil
	}
	seen := make(map[string]bool)
	for _, provider := range routing.Only {
		if provider == "" || seen[provider] {
			return &ParameterError{"routing.only", "invalid_provider"}
		}
		seen[provider] = true
	}
	for provider, variant := range routing.Variants {
		if provider == "" || variant == "" {
			return &ParameterError{"routing.variants", "invalid_variant"}
		}
	}
	return nil
}
