package yir

import (
	"regexp"
	"slices"
)

// SubjectReferenceLimits is declared by an input constraint whose
// reference_image photos may be grouped into named characters with
// Reference.Subject. Non-empty value lists replace the operation parameter
// values for requests that use subjects.
type SubjectReferenceLimits struct {
	MinImagesPerSubject int      `json:"min_images_per_subject"`
	MaxImagesPerSubject int      `json:"max_images_per_subject"`
	MaxSubjects         int      `json:"max_subjects"`
	Resolutions         []string `json:"resolutions,omitempty"`
	AspectRatios        []string `json:"aspect_ratios,omitempty"`
	DefaultAspectRatio  string   `json:"default_aspect_ratio,omitempty"`
	AllowedDurations    []int    `json:"allowed_durations,omitempty"`
	MinDurationSeconds  int      `json:"min_duration_seconds,omitempty"`
	MaxDurationSeconds  int      `json:"max_duration_seconds,omitempty"`
	AllowedAudios       []bool   `json:"allowed_audios,omitempty"`
}

var subjectNamePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,31}$`)

func cloneSubjectReferenceLimits(source *SubjectReferenceLimits) *SubjectReferenceLimits {
	if source == nil {
		return nil
	}
	result := *source
	result.Resolutions = slices.Clone(source.Resolutions)
	result.AspectRatios = slices.Clone(source.AspectRatios)
	result.AllowedDurations = slices.Clone(source.AllowedDurations)
	result.AllowedAudios = slices.Clone(source.AllowedAudios)
	return &result
}

// validateSubjectReferences checks the stable subject structure. With a
// contract it returns the constraint and parameters that apply to the
// subject mode; without one the Gateway checks the model limits.
func validateSubjectReferences(request GenerationRequest, constraint *ModelInputConstraint, contract *ModelOperationContract) (*ModelInputConstraint, *ModelOperationContract, error) {
	labelled := 0
	for _, reference := range request.Input.References {
		if reference.Subject != "" {
			labelled++
		}
	}
	if labelled == 0 {
		return constraint, contract, nil
	}
	groups := make(map[string]int)
	for _, reference := range request.Input.References {
		if request.Input.Type != "reference" || reference.Role != "reference_image" || !subjectNamePattern.MatchString(reference.Subject) {
			return nil, nil, &ParameterError{"input.references", "invalid_reference_subject"}
		}
		groups[reference.Subject]++
	}
	if constraint == nil || contract == nil {
		return constraint, contract, nil
	}
	limits := constraint.SubjectReferences
	if limits == nil {
		return nil, nil, &ParameterError{"input.references", "reference_subject_not_supported"}
	}
	if len(groups) > limits.MaxSubjects {
		return nil, nil, &ParameterError{"input.references", "invalid_reference_subject_count"}
	}
	for _, count := range groups {
		if count < limits.MinImagesPerSubject || count > limits.MaxImagesPerSubject {
			return nil, nil, &ParameterError{"input.references", "invalid_reference_subject_count"}
		}
	}
	subjectConstraint := ModelInputConstraint{
		PromptOptional: constraint.PromptOptional,
		MinReferences:  limits.MinImagesPerSubject, MaxReferences: limits.MaxImagesPerSubject * limits.MaxSubjects,
		AllowedReferenceRoles: []string{"reference_image"}, RequiredReferenceRoles: []string{"reference_image"},
		SubjectReferences: cloneSubjectReferenceLimits(limits),
	}
	subjectContract := cloneModelOperationContract(*contract)
	for i := range subjectContract.Parameters {
		parameter := &subjectContract.Parameters[i]
		switch parameter.Name {
		case "resolution":
			if len(limits.Resolutions) > 0 {
				parameter.Values = anyValues(limits.Resolutions)
			}
		case "aspect_ratio":
			if len(limits.AspectRatios) > 0 {
				parameter.Values = anyValues(limits.AspectRatios)
			}
			if limits.DefaultAspectRatio != "" {
				parameter.Default = limits.DefaultAspectRatio
			}
		case "duration":
			if len(limits.AllowedDurations) > 0 || limits.MinDurationSeconds > 0 || limits.MaxDurationSeconds > 0 {
				parameter.Values = anyValues(limits.AllowedDurations)
				parameter.StringValues = nil
				parameter.Minimum, parameter.Maximum = nil, nil
				if limits.MinDurationSeconds > 0 {
					minimum := float64(limits.MinDurationSeconds)
					parameter.Minimum = &minimum
				}
				if limits.MaxDurationSeconds > 0 {
					maximum := float64(limits.MaxDurationSeconds)
					parameter.Maximum = &maximum
				}
			}
		case "generate_audio":
			if len(limits.AllowedAudios) > 0 {
				parameter.Values = anyValues(limits.AllowedAudios)
			}
		}
	}
	return &subjectConstraint, &subjectContract, nil
}

func anyValues[T any](values []T) []any {
	if len(values) == 0 {
		return nil
	}
	result := make([]any, len(values))
	for i, value := range values {
		result[i] = value
	}
	return result
}
