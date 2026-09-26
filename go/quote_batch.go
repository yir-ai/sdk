package yir

type QuoteBatchRequestItem struct {
	Operation string            `json:"operation"`
	Request   GenerationRequest `json:"request"`
}

type QuoteBatchItem struct {
	Index int       `json:"index"`
	Quote *Quote    `json:"quote,omitempty"`
	Error *APIError `json:"error,omitempty"`
}

type QuoteBatch struct {
	Object    string           `json:"object"`
	Data      []QuoteBatchItem `json:"data"`
	RequestID string           `json:"request_id"`
}
