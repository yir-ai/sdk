package yir

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCreateAndUploadFileRecoversLostCompletion(t *testing.T) {
	puts, creates, completes := 0, 0, 0
	upload := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		puts++
		if r.Method != "PUT" || r.Header.Get("Authorization") != "" {
			t.Error("upload credentials or method invalid")
		}
	}))
	defer upload.Close()
	metadata := CreateFile{Name: "frame.png", MediaType: "image/png", Size: 3}
	file := File{ID: testFileID, Object: "file", Name: metadata.Name, MediaType: metadata.MediaType, Size: metadata.Size, Status: "pending_upload",
		Upload: &FileUpload{Type: "multipart", ExpiresAt: time.Now().Add(time.Minute).Unix(), Parts: []UploadPart{{PartNumber: 1, Size: 3, URL: upload.URL}}}}
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/files":
			creates++
			if r.Header.Get("Idempotency-Key") != "persisted-preparation-key" {
				t.Error("preparation identity changed")
			}
			json.NewEncoder(w).Encode(map[string]any{"files": []File{file}})
		case "/v1/files/" + testFileID + "/complete":
			completes++
			file.Status, file.Upload = "ready", nil
			// Gateway 已完成，模拟响应丢失；调用方重试整项准备。
			w.WriteHeader(http.StatusServiceUnavailable)
		default:
			t.Error("unexpected request")
		}
	}))
	defer gateway.Close()
	client, err := NewClient("test-key", ClientOptions{BaseURL: gateway.URL, HTTPClient: upload.Client()})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.CreateAndUploadFile(context.Background(), metadata, strings.NewReader("abc"), "persisted-preparation-key")
	if err == nil {
		t.Fatal("lost completion reported as success")
	}
	ready, err := client.CreateAndUploadFile(context.Background(), metadata, strings.NewReader("abc"), "persisted-preparation-key")
	if err != nil || ready.ID != testFileID || ready.Status != "ready" || creates != 2 || puts != 1 || completes != 1 {
		t.Fatalf("recovery failed: ready=%s creates=%d puts=%d completes=%d err=%v", ready.Status, creates, puts, completes, err)
	}
}

func TestCreateAndUploadFileRejectsUnusableSourceAndReplay(t *testing.T) {
	calls := 0
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		json.NewEncoder(w).Encode(map[string]any{"files": []File{{ID: testFileID, Object: "file", Name: "frame.png", MediaType: "image/png", Size: 3, Status: "expired"}}})
	}))
	defer gateway.Close()
	client, _ := NewClient("test-key", ClientOptions{BaseURL: gateway.URL})
	metadata := CreateFile{Name: "frame.png", MediaType: "image/png", Size: 3}
	if _, err := client.CreateAndUploadFile(context.Background(), metadata, nil, "key"); err == nil || calls != 0 {
		t.Fatal("nil source sent a request")
	}
	if _, err := client.CreateAndUploadFile(context.Background(), metadata, strings.NewReader("abc"), "key"); err == nil || calls != 1 {
		t.Fatal("expired replay was reused or recreated")
	}
}
