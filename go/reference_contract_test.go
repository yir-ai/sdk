package yir

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestReferenceRoleContract(t *testing.T) {
	for _, tc := range []struct {
		images, videos, audios int
		valid                  bool
	}{
		{9, 3, 3, true}, {10, 0, 0, false}, {1, 4, 0, false}, {1, 0, 4, false}, {0, 0, 1, false},
	} {
		r := GenerationRequest{Model: "bytedance/seedance-2.0", Input: GenerationInput{Type: "reference", Prompt: "fixture"}}
		counter := 0
		for _, group := range []struct {
			role  string
			count int
		}{{"reference_image", tc.images}, {"reference_video", tc.videos}, {"reference_audio", tc.audios}} {
			for i := 0; i < group.count; i++ {
				fileID := fmt.Sprintf("file_12345678-1234-4123-8123-%012d", counter)
				counter++
				r.Input.References = append(r.Input.References, Reference{Role: group.role, FileID: fileID})
			}
		}
		if err := ValidateGeneration("generate_video", r); (err == nil) != tc.valid {
			t.Fatalf("%+v: %v", tc, err)
		}
	}
}

func TestReferenceOutputDurationContract(t *testing.T) {
	for _, tc := range []struct {
		role     string
		duration int
		valid    bool
	}{{"reference_video", 10, true}, {"reference_video", 11, false}, {"reference_image", 11, true}} {
		r := GenerationRequest{Model: "alibaba/wan-2.7", Input: GenerationInput{Type: "reference", Prompt: "fixture", References: []Reference{{Role: tc.role, FileID: "file_12345678-1234-4123-8123-123456789abc"}}}, Parameters: map[string]any{"duration": tc.duration}}
		if err := ValidateGeneration("generate_video", r); (err == nil) != tc.valid {
			t.Fatalf("%+v: %v", tc, err)
		}
	}
}

func TestReferenceDuplicatesAndContractIsolation(t *testing.T) {
	reference := Reference{Role: "reference_image", URL: "https://example.com/fixture"}
	request := GenerationRequest{Model: "bytedance/seedance-2.0", Input: GenerationInput{Type: "reference", Prompt: "fixture", References: []Reference{reference, reference}}}
	if err := ValidateGeneration("generate_video", request); err == nil {
		t.Fatal("duplicate references accepted")
	}
	contract, ok := GetModelOperationContract(request.Model, "generate_video", "reference")
	if !ok {
		t.Fatal("missing contract")
	}
	constraint := contract.InputConstraints["reference"]
	constraint.ReferenceCountsByRole["reference_image"] = ReferenceCountRange{Maximum: 100}
	constraint.RequiredAnyReferenceRoles[0] = "invalid"
	fresh, _ := GetModelOperationContract(request.Model, "generate_video", "reference")
	if fresh.InputConstraints["reference"].ReferenceCountsByRole["reference_image"].Maximum != 9 || fresh.InputConstraints["reference"].RequiredAnyReferenceRoles[0] == "invalid" {
		t.Fatal("returned contract mutation escaped into the bundled catalog")
	}
}

func TestH3ReferenceRoleContract(t *testing.T) {
	image, _ := GetModelOperationContract("minimax/minimax-h3", "generate_video", "image")
	for _, rule := range image.Parameters {
		if rule.Name == "aspect_ratio" && (len(rule.Values) != 1 || rule.Values[0] != "adaptive") {
			t.Fatal("image aspect ratio expanded")
		}
	}
	for _, tc := range []struct {
		images, videos, audios int
		valid                  bool
	}{{9, 0, 0, true}, {0, 3, 0, true}, {0, 0, 3, true}, {9, 3, 3, true}, {10, 0, 0, false}, {1, 4, 0, false}, {1, 0, 4, false}, {0, 0, 0, false}} {
		r := GenerationRequest{Model: "minimax/minimax-h3", Input: GenerationInput{Type: "reference", Prompt: "fixture"}}
		counter := 0
		for _, group := range []struct {
			role  string
			count int
		}{{"reference_audio", tc.audios}, {"reference_image", tc.images}, {"reference_video", tc.videos}} {
			for i := 0; i < group.count; i++ {
				fileID := fmt.Sprintf("file_12345678-1234-4123-8123-%012d", counter)
				counter++
				r.Input.References = append(r.Input.References, Reference{Role: group.role, FileID: fileID})
			}
		}
		before, _ := json.Marshal(r)
		if err := ValidateGeneration("generate_video", r); (err == nil) != tc.valid {
			t.Fatalf("%+v: %v", tc, err)
		}
		after, _ := json.Marshal(r)
		if string(before) != string(after) {
			t.Fatal("request mutated")
		}
	}
}

func TestReferenceSubjectContract(t *testing.T) {
	photo := func(subject string, i int) Reference {
		return Reference{Role: "reference_image", URL: fmt.Sprintf("https://example.com/%s-%d.png", subject, i), Subject: subject}
	}
	subjectRequest := func(parameters map[string]any, references ...Reference) GenerationRequest {
		return GenerationRequest{Model: "klingai/kling-3.0", Input: GenerationInput{Type: "reference", Prompt: "@hero meets @friend", References: references}, Parameters: parameters}
	}
	valid := subjectRequest(map[string]any{"resolution": "1080p", "aspect_ratio": "9:16", "duration": 10, "generate_audio": true},
		photo("hero", 1), photo("hero", 2), photo("friend", 1), photo("friend", 2), photo("friend", 3))
	if err := ValidateGeneration("generate_video", valid); err != nil {
		t.Fatalf("subject request rejected: %v", err)
	}
	// Omitted aspect_ratio resolves to the subject-mode default instead of motion's auto.
	if err := ValidateGeneration("generate_video", subjectRequest(map[string]any{}, photo("hero", 1), photo("hero", 2))); err != nil {
		t.Fatalf("subject defaults rejected: %v", err)
	}
	for name, request := range map[string]GenerationRequest{
		"one photo":        subjectRequest(map[string]any{}, photo("hero", 1)),
		"five photos":      subjectRequest(map[string]any{}, photo("a", 1), photo("a", 2), photo("a", 3), photo("a", 4), photo("a", 5)),
		"four subjects":    subjectRequest(map[string]any{}, photo("a", 1), photo("a", 2), photo("b", 1), photo("b", 2), photo("c", 1), photo("c", 2), photo("d", 1), photo("d", 2)),
		"motion aspect":    subjectRequest(map[string]any{"aspect_ratio": "auto"}, photo("hero", 1), photo("hero", 2)),
		"twenty seconds":   subjectRequest(map[string]any{"duration": 20}, photo("hero", 1), photo("hero", 2)),
		"invalid name":     subjectRequest(map[string]any{}, photo("1hero", 1), photo("1hero", 2)),
		"mixed unlabelled": subjectRequest(map[string]any{}, photo("hero", 1), photo("hero", 2), Reference{Role: "reference_image", URL: "https://example.com/x.png"}),
		"no subject model": {Model: "bytedance/seedance-2.0", Input: GenerationInput{Type: "reference", Prompt: "fixture", References: []Reference{photo("hero", 1), photo("hero", 2)}}},
	} {
		if err := ValidateGeneration("generate_video", request); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	encoded, err := json.Marshal(photo("hero", 1))
	if err != nil || string(encoded) != `{"role":"reference_image","url":"https://example.com/hero-1.png","subject":"hero"}` {
		t.Fatalf("subject wire shape: %s %v", encoded, err)
	}
}

// Kling 4.0 declares mixed subjects: photo characters, their voices and standalone
// voices sit next to ungrouped reference images, and counts use items, not files.
func TestMixedSubjectReferenceContract(t *testing.T) {
	photo := func(subject string, i int) Reference {
		return Reference{Role: "reference_image", URL: fmt.Sprintf("https://example.com/%s-%d.png", subject, i), Subject: subject}
	}
	voice := func(subject string) Reference {
		return Reference{Role: "reference_audio", URL: "https://example.com/" + subject + ".mp3", Subject: subject}
	}
	request := func(references ...Reference) GenerationRequest {
		return GenerationRequest{Model: "klingai/kling-4.0", Input: GenerationInput{Type: "reference", Prompt: "@Hero holds @image_1", References: references}, Parameters: map[string]any{}}
	}
	plain := func(i int) Reference { return photo("", i) }
	for name, valid := range map[string]GenerationRequest{
		"mixed":      request(photo("Hero", 1), plain(1), photo("Hero", 2), voice("Hero"), voice("Narrator")),
		"voice only": request(voice("Narrator")),
		"plain only": request(plain(1), plain(2)),
		"ten plain":  request(plain(1), plain(2), plain(3), plain(4), plain(5), plain(6), plain(7), plain(8), plain(9), plain(10), photo("Hero", 1), photo("Hero", 2)),
	} {
		if err := ValidateGeneration("generate_video", valid); err != nil {
			t.Fatalf("%s rejected: %v", name, err)
		}
	}
	for name, invalid := range map[string]GenerationRequest{
		"eleven plain":    request(plain(1), plain(2), plain(3), plain(4), plain(5), plain(6), plain(7), plain(8), plain(9), plain(10), plain(11)),
		"one photo":       request(photo("Hero", 1)),
		"two voices":      request(voice("Hero"), voice("Hero")),
		"four voice-only": request(voice("A"), voice("B"), voice("C"), voice("D")),
		"ungrouped audio": request(plain(1), Reference{Role: "reference_audio", URL: "https://example.com/a.mp3"}),
		"sixteen items": request(plain(1), plain(2), plain(3), plain(4), plain(5), plain(6), plain(7), plain(8), plain(9), plain(10),
			photo("A", 1), photo("A", 2), photo("B", 1), photo("B", 2), photo("C", 1), photo("C", 2), photo("D", 1), photo("D", 2), photo("E", 1), photo("E", 2), photo("F", 1), photo("F", 2)),
	} {
		if err := ValidateGeneration("generate_video", invalid); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	// Kling 3.0 is not mixed: a voice subject is rejected there.
	kling3 := request(photo("hero", 1), photo("hero", 2), voice("hero"))
	kling3.Model = "klingai/kling-3.0"
	if err := ValidateGeneration("generate_video", kling3); err == nil {
		t.Fatal("kling 3.0 voice subject accepted")
	}
}

// Kling 4.0 video characters: one reference_video per subject, no photos, at most three.
func TestVideoSubjectReferenceContract(t *testing.T) {
	video := func(subject string, i int) Reference {
		return Reference{Role: "reference_video", URL: fmt.Sprintf("https://example.com/%s-%d.mp4", subject, i), Subject: subject}
	}
	photo := func(subject string, i int) Reference {
		return Reference{Role: "reference_image", URL: fmt.Sprintf("https://example.com/%s-%d.png", subject, i), Subject: subject}
	}
	request := func(model string, references ...Reference) GenerationRequest {
		return GenerationRequest{Model: model, Input: GenerationInput{Type: "reference", Prompt: "@Hero in @video_1", References: references}, Parameters: map[string]any{}}
	}
	for name, valid := range map[string]GenerationRequest{
		"video subject":           request("klingai/kling-4.0", video("Hero", 1)),
		"video subject and voice": request("klingai/kling-4.0", video("Hero", 1), Reference{Role: "reference_audio", URL: "https://example.com/h.mp3", Subject: "Hero"}),
		"plain video":             request("klingai/kling-4.0", video("", 1), video("", 2)),
	} {
		if err := ValidateGeneration("generate_video", valid); err != nil {
			t.Fatalf("%s rejected: %v", name, err)
		}
	}
	for name, invalid := range map[string]GenerationRequest{
		"video subject with photos": request("klingai/kling-4.0", video("Hero", 1), photo("Hero", 1), photo("Hero", 2)),
		"two videos one subject":    request("klingai/kling-4.0", video("Hero", 1), video("Hero", 2)),
		"four video subjects":       request("klingai/kling-4.0", video("A", 1), video("B", 1), video("C", 1), video("D", 1)),
		"six plain videos":          request("klingai/kling-4.0", video("", 1), video("", 2), video("", 3), video("", 4), video("", 5), video("", 6)),
		"kling 3.0 video subject":   request("klingai/kling-3.0", video("hero", 1)),
	} {
		if err := ValidateGeneration("generate_video", invalid); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

func TestKeyframeContract(t *testing.T) {
	frame := func(role, name string) Reference {
		return Reference{Role: role, URL: "https://example.com/" + name + ".png"}
	}
	request := func(references ...Reference) GenerationRequest {
		return GenerationRequest{Model: "klingai/kling-4.0", Input: GenerationInput{Type: "image", Prompt: "@first_frame then @keyframe_1", References: references}, Parameters: map[string]any{"duration": 10}}
	}
	// Keyframes keep their order and may repeat a shot.
	if err := ValidateGeneration("generate_video", request(frame("first_frame", "a"), frame("keyframe", "b"), frame("keyframe", "b"), frame("last_frame", "c"))); err != nil {
		t.Fatal(err)
	}
	nine := []Reference{frame("first_frame", "a")}
	for i := 0; i < 9; i++ {
		nine = append(nine, frame("keyframe", fmt.Sprint(i)))
	}
	for name, r := range map[string]GenerationRequest{
		"nine keyframes":       request(nine...),
		"duplicate last frame": request(frame("first_frame", "a"), frame("last_frame", "c"), frame("last_frame", "c")),
		"other model":          {Model: "klingai/kling-3.0", Input: GenerationInput{Type: "image", Prompt: "fixture", References: []Reference{frame("first_frame", "a"), frame("keyframe", "b")}}},
	} {
		if ValidateGeneration("generate_video", r) == nil {
			t.Fatal(name)
		}
	}
}
