package yir

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// DemoScenario selects how a demo Job ends. DemoScenarioOK succeeds,
// DemoScenarioSlow stays queued for 6 minutes before succeeding,
// DemoScenarioFail fails with nothing charged, DemoScenarioReject makes the
// submit itself return 422 YIR_INPUT_REJECTED, and DemoScenarioCancel ends
// cancelled. A "[demo:<scenario>]" marker in the prompt overrides the option.
type DemoScenario string

const (
	DemoScenarioOK     DemoScenario = "ok"
	DemoScenarioSlow   DemoScenario = "slow"
	DemoScenarioFail   DemoScenario = "fail"
	DemoScenarioReject DemoScenario = "reject"
	DemoScenarioCancel DemoScenario = "cancel"
)

// DemoOptions turns on demo mode: submits are quoted by the Gateway (free, with
// the same parameter checks as a submit) but never sent, and return a demo Job
// that goes from queued to a DEMO-badged sample result without charge. Quotes,
// files and account calls still use the Gateway. Demo Job IDs start with
// "demo_" and every Client answers them locally, demo mode or not.
type DemoOptions struct {
	// Scenario defaults to DemoScenarioOK.
	Scenario DemoScenario
}

// The Job ID carries everything a later read needs, so any process derives the
// same Job without shared state (same layout as the TypeScript SDK):
//
//	demo_1 <created:6> <kind> <aspect> <n> <duration:2> <resolution> <scenario> <nonce:4> _ <model, "/" as "~">
//
// The code lists are append-only.
const (
	demoPrefix         = "demo_1"
	demoHead           = len(demoPrefix) + 17
	demoMaxModelLength = 64 - demoHead - 1
	demoAutoDuration   = 36*36 - 1
	demoResultTTL      = 7 * 24 * 3600
)

var (
	demoKinds          = map[byte]string{'i': "image", 'v': "video", 'm': "music", 'x': "sound_effect", 't': "speech"}
	demoOperationKinds = map[string]byte{"generate_image": 'i', "generate_video": 'v', "generate_music": 'm', "generate_sound_effect": 'x', "generate_speech": 't'}
	demoAspects        = []string{"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21", "4:5", "5:4", "2:1", "1:2", "3:1", "1:3", "4:1", "1:4", "8:1", "1:8", "auto", "adaptive"}
	demoResolutions    = []string{"480p", "720p", "1080p", "768P", "0.5K", "1K", "2K", "3K", "4K", "1MP", "native", "540p", "1440p", "2160p"}
	demoScenarioCodes  = map[DemoScenario]byte{DemoScenarioOK: 'o', DemoScenarioSlow: 's', DemoScenarioFail: 'f', DemoScenarioReject: 'r', DemoScenarioCancel: 'c'}
	demoIDPattern      = regexp.MustCompile(`^demo_1[0-9a-z]{6}[imxtv][0-9a-z][1-9a-z][0-9a-z]{2}[0-9a-z][osfrc][0-9a-z]{4}_[a-z0-9._~-]+$`)
	demoMarkerPattern  = regexp.MustCompile(`(?i)\[demo:(ok|slow|fail|reject|cancel)\]`)
	// Seconds after creation: running, terminal. The slow scenario queues for 6 minutes.
	demoTimelines    = map[string][2]int64{"image": {2, 8}, "video": {3, 25}, "music": {2, 12}, "sound_effect": {2, 12}, "speech": {2, 12}}
	demoSlowTimeline = [2]int64{360, 480}
	demoNow          = time.Now
)

// IsDemoJobID reports whether id belongs to a demo-mode Job, which the SDK answers locally.
func IsDemoJobID(id string) bool {
	return len(id) <= 64 && demoIDPattern.MatchString(id)
}

type demoFields struct {
	id          string
	created     int64
	kind        string
	aspectRatio string
	n           int64
	duration    any
	resolution  string
	scenario    DemoScenario
	model       string
}

func validDemoScenario(scenario DemoScenario) bool {
	_, ok := demoScenarioCodes[scenario]
	return scenario == "" || ok
}

func demoScenarioFor(prompt string, option DemoScenario) DemoScenario {
	if match := demoMarkerPattern.FindStringSubmatch(prompt); match != nil {
		return DemoScenario(strings.ToLower(match[1]))
	}
	if option == "" {
		return DemoScenarioOK
	}
	return option
}

func demoCode(list []string, value any) string {
	text, _ := value.(string)
	for index, candidate := range list {
		if candidate == text {
			return strconv.FormatInt(int64(index+1), 36)
		}
	}
	return "0"
}

func demoNumber(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	case json.Number:
		parsed, err := number.Float64()
		return parsed, err == nil
	}
	return 0, false
}

func newDemoJob(quote Quote, scenario DemoScenario, now time.Time) (Job, error) {
	model := strings.ReplaceAll(quote.Model, "/", "~")
	if len(model) > demoMaxModelLength {
		return Job{}, errors.New("demo_model_id_too_long")
	}
	n := int64(1)
	if value, ok := demoNumber(quote.Parameters["n"]); ok {
		n = min(max(int64(value), 1), 35)
	}
	duration := int64(0)
	if quote.Parameters["duration"] == "auto" {
		duration = demoAutoDuration
	} else if value, ok := demoNumber(quote.Parameters["duration"]); ok {
		duration = min(max(int64(math.Round(value)), 0), demoAutoDuration-1)
	}
	kind, ok := demoOperationKinds[quote.Operation]
	if !ok {
		kind = 'i'
	}
	random := make([]byte, 4)
	if _, err := rand.Read(random); err != nil {
		return Job{}, err
	}
	nonce := make([]byte, 4)
	for index, value := range random {
		nonce[index] = strconv.FormatInt(int64(value%36), 36)[0]
	}
	pad := func(text string, width int) string { return strings.Repeat("0", max(width-len(text), 0)) + text }
	id := demoPrefix + pad(strconv.FormatInt(now.Unix(), 36), 6) + string(kind) +
		demoCode(demoAspects, quote.Parameters["aspect_ratio"]) + strconv.FormatInt(n, 36) +
		pad(strconv.FormatInt(duration, 36), 2) + demoCode(demoResolutions, quote.Parameters["resolution"]) +
		string(demoScenarioCodes[scenario]) + string(nonce) + "_" + model
	job := demoJob(decodeDemoID(id), now, nil)
	job.Parameters = quote.Parameters
	return withDemoRaw(job), nil
}

func decodeDemoID(id string) demoFields {
	field := func(start, length int) int64 {
		value, _ := strconv.ParseInt(id[len(demoPrefix)+start:len(demoPrefix)+start+length], 36, 64)
		return value
	}
	listed := func(list []string, index int64) string {
		if index > 0 && int(index) <= len(list) {
			return list[index-1]
		}
		return ""
	}
	fields := demoFields{
		id:          id,
		created:     field(0, 6),
		kind:        demoKinds[id[len(demoPrefix)+6]],
		aspectRatio: listed(demoAspects, field(7, 1)),
		n:           field(8, 1),
		resolution:  listed(demoResolutions, field(11, 1)),
		scenario:    DemoScenarioOK,
		model:       strings.ReplaceAll(id[demoHead+1:], "~", "/"),
	}
	if duration := field(9, 2); duration == demoAutoDuration {
		fields.duration = "auto"
	} else if duration > 0 {
		fields.duration = duration
	}
	for scenario, code := range demoScenarioCodes {
		if code == id[len(demoPrefix)+12] {
			fields.scenario = scenario
		}
	}
	return fields
}

func (f demoFields) timeline() [2]int64 {
	span := demoTimelines[f.kind]
	if f.scenario == DemoScenarioSlow {
		span = demoSlowTimeline
	}
	return [2]int64{f.created + span[0], f.created + span[1]}
}

func (f demoFields) statusAt(seconds int64) string {
	span := f.timeline()
	switch {
	case seconds < span[0]:
		return "queued"
	case seconds < span[1]:
		return "running"
	case f.scenario == DemoScenarioFail:
		return "failed"
	case f.scenario == DemoScenarioCancel:
		return "cancelled"
	}
	return "succeeded"
}

// demoNextChange is the wait until the next status change, or zero once terminal.
func demoNextChange(id string, now time.Time) time.Duration {
	for _, at := range decodeDemoID(id).timeline() {
		if wait := time.UnixMilli(at * 1000).Sub(now); wait > 0 {
			return wait
		}
	}
	return 0
}

func demoRatio(aspect string) (float64, bool) {
	width, height, found := strings.Cut(aspect, ":")
	w, errW := strconv.Atoi(width)
	h, errH := strconv.Atoi(height)
	if !found || errW != nil || errH != nil || w <= 0 || h <= 0 {
		return 0, false
	}
	return float64(w) / float64(h), true
}

// demoFiles picks the nearest published aspect (and video length); results report the real file's size.
func (f demoFields) assets() []demoAsset {
	var candidates []demoAsset
	for _, asset := range demoAssets {
		if asset.Kind == f.kind {
			candidates = append(candidates, asset)
		}
	}
	if f.kind != "image" && f.kind != "video" {
		return candidates
	}
	wanted, ok := demoRatio(f.aspectRatio)
	if !ok {
		wanted = 16.0 / 9
		if f.kind == "image" {
			wanted = 1
		}
	}
	nearest := func(list []demoAsset, distance func(demoAsset) float64) []demoAsset {
		best := math.Inf(1)
		for _, asset := range list {
			best = math.Min(best, distance(asset))
		}
		var matching []demoAsset
		for _, asset := range list {
			if distance(asset) == best {
				matching = append(matching, asset)
			}
		}
		return matching
	}
	matching := nearest(candidates, func(asset demoAsset) float64 {
		ratio, _ := demoRatio(asset.AspectRatio)
		return math.Abs(math.Log(ratio / wanted))
	})
	if f.kind == "video" {
		seconds := 5.0
		if value, ok := f.duration.(int64); ok {
			seconds = float64(value)
		}
		matching = nearest(matching, func(asset demoAsset) float64 { return math.Abs(float64(asset.Duration) - seconds) })
	}
	return matching
}

func demoJob(f demoFields, now time.Time, cancelledAt *int64) Job {
	status := f.statusAt(now.Unix())
	completed := f.timeline()[1]
	if cancelledAt != nil {
		status, completed = "cancelled", *cancelledAt
	}
	terminal := status == "succeeded" || status == "failed" || status == "cancelled"
	parameters := map[string]any{"n": f.n}
	if f.aspectRatio != "" {
		parameters["aspect_ratio"] = f.aspectRatio
	}
	if f.resolution != "" {
		parameters["resolution"] = f.resolution
	}
	if f.duration != nil {
		parameters["duration"] = f.duration
	}
	job := Job{
		ID:         f.id,
		Object:     "job",
		Status:     status,
		Model:      f.model,
		Parameters: parameters,
		URLs:       &JobURLs{Get: "/v1/jobs/" + f.id, Cancel: "/v1/jobs/" + f.id + "/cancel"},
		CreatedAt:  f.created,
		Billing: &JobBilling{
			Status:            "pending",
			Currency:          "USD",
			ComputeCharges:    []ComputeCharge{},
			GatewayFee:        GatewayFee{Amount: "0", Status: "waived"},
			TotalChargedByYir: "0",
		},
	}
	if terminal {
		job.CompletedAt = &completed
		job.Billing.Status = "settled"
	}
	switch status {
	case "failed":
		job.Error = &APIError{Code: ErrCodeExecutionFailed, Message: "Demo Job failed by the fail scenario; nothing was charged."}
	case "cancelled":
		job.Cancellation = &JobCancellation{Status: "cancelled", RequestedAt: completed}
	case "succeeded":
		pool := f.assets()
		files := make([]ResultFile, f.n)
		for index := range files {
			asset := pool[index%len(pool)]
			url := DemoAssetBaseURL + asset.Path
			if index >= len(pool) {
				url += "?i=" + strconv.Itoa(index)
			}
			files[index] = ResultFile{URL: url, MediaType: asset.MediaType, Width: asset.Width, Height: asset.Height,
				DurationMS: asset.DurationMS, ExpiresAt: completed + demoResultTTL}
		}
		job.FinalProvider = "yir-demo"
		job.Usage = &JobUsage{Outputs: f.n}
		job.Result = &JobResult{Availability: "available", Files: files}
	}
	return job
}

// withDemoRaw gives a demo Job the RawJSON a Gateway response would have.
func withDemoRaw(job Job) Job {
	data, _ := json.Marshal(job)
	job.raw = string(data)
	return job
}

func demoJobStatus(job Job) JobStatusResponse {
	status := JobStatusResponse{ID: job.ID, Status: job.Status, Error: job.Error, Cancellation: job.Cancellation}
	data, _ := json.Marshal(status)
	status.raw = string(data)
	return status
}

func (c *Client) demoSubmit(ctx context.Context, resource, operation string, request SubmitRequest) (Job, error) {
	quote, err := c.quote(ctx, resource, operation, request.GenerationRequest)
	if err != nil {
		return Job{}, err
	}
	scenario := demoScenarioFor(request.Input.Prompt, c.demo.Scenario)
	if scenario == DemoScenarioReject {
		return Job{}, &APIError{Status: 422, Code: ErrCodeInputRejected, Message: "Demo submit rejected by the reject scenario."}
	}
	return newDemoJob(quote, scenario, demoNow())
}

// demoJobStatusWithWait holds like the Gateway: until the next status change or the wait ends.
func demoJobStatusWithWait(ctx context.Context, id string, wait time.Duration) (JobStatusResponse, error) {
	if hold := min(wait.Truncate(time.Second), demoNextChange(id, demoNow())); hold > 0 {
		timer := time.NewTimer(hold)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return JobStatusResponse{}, ctx.Err()
		case <-timer.C:
		}
	}
	return demoJobStatus(demoJob(decodeDemoID(id), demoNow(), nil)), nil
}

// cancelDemoJob cancels an unfinished demo Job. Demo Jobs keep no state: later
// reads follow the original timeline, so keep the Job this returns.
func cancelDemoJob(id string) (Job, error) {
	fields, now := decodeDemoID(id), demoNow()
	if status := fields.statusAt(now.Unix()); status != "queued" && status != "running" {
		return Job{}, &APIError{Status: 409, Code: ErrCodeJobNotCancellable, Message: "The demo Job has already ended."}
	}
	at := now.Unix()
	return withDemoRaw(demoJob(fields, now, &at)), nil
}
