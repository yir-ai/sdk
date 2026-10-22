package yir

import (
	"regexp"
	"slices"
)

// SubjectReferenceLimits is declared by an input constraint whose
// reference_image photos may be grouped into named characters with
// Reference.Subject. Non-empty value lists replace the operation parameter
// values for requests that use subjects. With Mixed, subjects coexist with
// ungrouped references and the operation values stay; MinReferences and
// MaxReferences then count ungrouped references plus subjects, and role
// counts apply to ungrouped references only.
type SubjectReferenceLimits struct {
	MinImagesPerSubject int `json:"min_images_per_subject"`
	MaxImagesPerSubject int `json:"max_images_per_subject"`
	// MaxSubjects is the maximum number of subjects with photos.
	MaxSubjects int  `json:"max_subjects"`
	Mixed       bool `json:"mixed,omitempty"`
	// MaxAudiosPerSubject is the reference_audio allowed per subject as its
	// voice; zero means subjects take photos only.
	MaxAudiosPerSubject int `json:"max_audios_per_subject,omitempty"`
	// MaxAudioOnlySubjects caps subjects that have only reference_audio
	// (standalone voices).
	MaxAudioOnlySubjects int `json:"max_audio_only_subjects,omitempty"`
	// MaxVideosPerSubject is the reference_video allowed per subject as a
	// video character (which then takes no photos); zero means no video subjects.
	MaxVideosPerSubject int `json:"max_videos_per_subject,omitempty"`
	// MaxVideoSubjects caps subjects built from reference_video.
	MaxVideoSubjects   int      `json:"max_video_subjects,omitempty"`
	Resolutions        []string `json:"resolutions,omitempty"`
	AspectRatios       []string `json:"aspect_ratios,omitempty"`
	DefaultAspectRatio string   `json:"default_aspect_ratio,omitempty"`
	AllowedDurations   []int    `json:"allowed_durations,omitempty"`
	MinDurationSeconds int      `json:"min_duration_seconds,omitempty"`
	MaxDurationSeconds int      `json:"max_duration_seconds,omitempty"`
	AllowedAudios      []bool   `json:"allowed_audios,omitempty"`
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
	type group struct{ images, videos, audios int }
	groups := make(map[string]*group)
	ungrouped, audios, videos := 0, 0, 0
	for _, reference := range request.Input.References {
		if reference.Subject == "" {
			ungrouped++
			continue
		}
		if request.Input.Type != "reference" || (reference.Role != "reference_image" && reference.Role != "reference_audio" && reference.Role != "reference_video") || !subjectNamePattern.MatchString(reference.Subject) {
			return nil, nil, &ParameterError{"input.references", "invalid_reference_subject"}
		}
		if groups[reference.Subject] == nil {
			groups[reference.Subject] = &group{}
		}
		switch reference.Role {
		case "reference_audio":
			groups[reference.Subject].audios++
			audios++
		case "reference_video":
			groups[reference.Subject].videos++
			videos++
		default:
			groups[reference.Subject].images++
		}
	}
	if len(groups) == 0 || constraint == nil || contract == nil {
		return constraint, contract, nil
	}
	limits := constraint.SubjectReferences
	if limits == nil {
		return nil, nil, &ParameterError{"input.references", "reference_subject_not_supported"}
	}
	if !limits.Mixed && ungrouped > 0 || limits.MaxAudiosPerSubject == 0 && audios > 0 || limits.MaxVideosPerSubject == 0 && videos > 0 {
		return nil, nil, &ParameterError{"input.references", "invalid_reference_subject"}
	}
	photoSubjects, audioOnly, videoSubjects := 0, 0, 0
	for _, g := range groups {
		if g.audios > limits.MaxAudiosPerSubject {
			return nil, nil, &ParameterError{"input.references", "invalid_reference_subject_count"}
		}
		if g.videos > 0 {
			if g.videos > limits.MaxVideosPerSubject || g.images > 0 {
				return nil, nil, &ParameterError{"input.references", "invalid_reference_subject_count"}
			}
			videoSubjects++
			continue
		}
		if g.images == 0 {
			audioOnly++
			continue
		}
		photoSubjects++
		if g.images < limits.MinImagesPerSubject || g.images > limits.MaxImagesPerSubject {
			return nil, nil, &ParameterError{"input.references", "invalid_reference_subject_count"}
		}
	}
	if photoSubjects > limits.MaxSubjects || audioOnly > limits.MaxAudioOnlySubjects || videoSubjects > limits.MaxVideoSubjects {
		return nil, nil, &ParameterError{"input.references", "invalid_reference_subject_count"}
	}
	if limits.Mixed {
		return constraint, contract, nil
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
