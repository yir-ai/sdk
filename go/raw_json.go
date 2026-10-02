package yir

import "encoding/json"

// Response types keep the exact JSON they were decoded from, so fields newer
// than this SDK (including nested ones such as billing details) stay readable
// through RawJSON before a release models them. The bytes are held in a string
// so these types stay comparable; RawJSON returns nil for values built in code.

// RawJSON returns the response body this Job was decoded from.
func (job Job) RawJSON() json.RawMessage { return rawJSON(job.raw) }

// RawJSON returns the response body this status summary was decoded from.
func (s JobStatusResponse) RawJSON() json.RawMessage { return rawJSON(s.raw) }

// RawJSON returns the response object this Quote was decoded from.
func (q Quote) RawJSON() json.RawMessage { return rawJSON(q.raw) }

// RawJSON returns the response body this File was decoded from.
func (file File) RawJSON() json.RawMessage { return rawJSON(file.raw) }

// RawJSON returns the response body this ModelDetail was decoded from.
func (detail ModelDetail) RawJSON() json.RawMessage { return rawJSON(detail.raw) }

func (job *Job) UnmarshalJSON(data []byte) error {
	type plain Job
	value := plain(*job)
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*job = Job(value)
	job.raw = string(data)
	return nil
}

func (s *JobStatusResponse) UnmarshalJSON(data []byte) error {
	type plain JobStatusResponse
	value := plain(*s)
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*s = JobStatusResponse(value)
	s.raw = string(data)
	return nil
}

func (q *Quote) UnmarshalJSON(data []byte) error {
	type plain Quote
	value := plain(*q)
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*q = Quote(value)
	q.raw = string(data)
	return nil
}

func (file *File) UnmarshalJSON(data []byte) error {
	type plain File
	value := plain(*file)
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*file = File(value)
	file.raw = string(data)
	return nil
}

func (detail *ModelDetail) UnmarshalJSON(data []byte) error {
	type plain ModelDetail
	value := plain(*detail)
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*detail = ModelDetail(value)
	detail.raw = string(data)
	return nil
}

func rawJSON(raw string) json.RawMessage {
	if raw == "" {
		return nil
	}
	return json.RawMessage(raw)
}
