package yir

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testFileID = "file_11111111-1111-4111-8111-111111111111"

func TestFileCreationNormalizesMetadataWithoutMutatingCaller(t *testing.T) {
	metadata := CreateFile{Name: " frame.png ", MediaType: " Image/PNG ", Size: 1}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request CreateFilesRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if len(request.Files) != 1 || request.Files[0].Name != "frame.png" || request.Files[0].MediaType != "image/png" {
			t.Error("request is not normalized")
		}
		json.NewEncoder(w).Encode(map[string]any{"files": []File{{ID: testFileID, Object: "file", Status: "ready", Name: "frame.png", MediaType: "image/png", Size: 1}}})
	}))
	defer server.Close()
	client, err := NewClient("key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	request := CreateFilesRequest{Files: []CreateFile{metadata}}
	if _, err := client.CreateFiles(context.Background(), request, "key"); err != nil {
		t.Fatal(err)
	}
	if request.Files[0] != metadata {
		t.Fatal("caller metadata mutated")
	}
	if _, err := client.CreateAndUploadFile(context.Background(), metadata, strings.NewReader("x"), "key"); err != nil {
		t.Fatal(err)
	}
}

func TestFileCreationRejectsInvalidMetadataBeforeHTTP(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(400) }))
	defer server.Close()
	client, err := NewClient("key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{strings.Repeat("图", 86), "a/b.png", "a\\b.png", "a\x00.png", string([]byte{0xff})} {
		if _, err := client.CreateFiles(context.Background(), CreateFilesRequest{Files: []CreateFile{{Name: name, MediaType: "image/png", Size: 1}}}, "key"); err == nil {
			t.Fatal("invalid name accepted")
		}
	}
	if _, err := client.CreateFiles(context.Background(), CreateFilesRequest{Files: []CreateFile{{Name: "a.png", MediaType: "image/png", Size: 1}}}, strings.Repeat("k", 256)); err == nil {
		t.Fatal("long key accepted")
	}
	if calls != 0 {
		t.Fatalf("invalid input made %d requests", calls)
	}
}

func TestFileUploadStreamsPartsWithoutGatewayCredentials(t *testing.T) {
	var parts []string
	upload := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PUT" || r.Header.Get("Authorization") != "" || r.Header.Get("Idempotency-Key") != "" {
			t.Error("upload leaked credentials or used wrong method")
		}
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		if int64(len(raw)) != r.ContentLength {
			t.Error("content length drift")
		}
		parts = append(parts, string(raw))
		w.WriteHeader(200)
	}))
	defer upload.Close()
	file := File{ID: testFileID, Object: "file", Status: "pending_upload", Name: "frame.png", MediaType: "image/png", Size: 6,
		Upload: &FileUpload{Type: "multipart", ExpiresAt: time.Now().Add(time.Minute).Unix(), Parts: []UploadPart{
			{PartNumber: 1, Size: 2, URL: upload.URL + "/1"}, {PartNumber: 2, Size: 4, URL: upload.URL + "/2"},
		}},
	}
	var completed bool
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gateway-secret" {
			t.Error("missing gateway auth")
		}
		switch r.URL.Path {
		case "/v1/files":
			if r.Header.Get("Idempotency-Key") != "create-key" {
				t.Error("missing create key")
			}
			json.NewEncoder(w).Encode(map[string]any{"files": []File{file}})
		case "/v1/files/" + testFileID + "/complete":
			body, _ := io.ReadAll(r.Body)
			if string(body) != "{}" || len(parts) != 2 {
				t.Error("premature or invalid completion")
			}
			completed = true
			ready := file
			ready.Status = "ready"
			ready.Upload = nil
			json.NewEncoder(w).Encode(ready)
		default:
			t.Error("wrong file path")
		}
	}))
	defer gateway.Close()
	client, err := NewClient("gateway-secret", ClientOptions{BaseURL: gateway.URL, HTTPClient: upload.Client()})
	if err != nil {
		t.Fatal(err)
	}
	files, err := client.CreateFiles(context.Background(), CreateFilesRequest{Files: []CreateFile{{Name: "frame.png", MediaType: "image/png", Size: 6}}}, "create-key")
	if err != nil {
		t.Fatal(err)
	}
	ready, err := client.UploadFile(context.Background(), files[0], strings.NewReader("abcdef"))
	if err != nil || ready.Status != "ready" || !completed || strings.Join(parts, "|") != "ab|cdef" {
		t.Fatalf("parts=%v ready=%s err=%v", parts, ready.Status, err)
	}
}

func TestInvalidUploadPlanDoesNotStartUpload(t *testing.T) {
	var calls int
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
	defer server.Close()
	client, _ := NewClient("key", ClientOptions{BaseURL: server.URL, HTTPClient: server.Client()})
	for _, parts := range [][]UploadPart{
		{{PartNumber: 1, Size: 2, URL: server.URL}},
		{{PartNumber: 1, Size: 3, URL: "http://example.com"}},
		{{PartNumber: 2, Size: 3, URL: server.URL}},
		{{PartNumber: 1, Size: 4, URL: server.URL}},
	} {
		file := File{ID: testFileID, Object: "file", Status: "pending_upload", Size: 3, Upload: &FileUpload{Type: "multipart", ExpiresAt: time.Now().Add(time.Minute).Unix(), Parts: parts}}
		if _, err := client.UploadFile(context.Background(), file, strings.NewReader("abc")); err == nil {
			t.Fatal("invalid plan accepted")
		}
	}
	if calls != 0 {
		t.Fatal("invalid plan performed network requests")
	}
}

func TestFailedUploadDoesNotConfirmCompletion(t *testing.T) {
	var calls int
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "PUT" {
			t.Error("confirmed failed upload")
		}
		w.WriteHeader(503)
		io.WriteString(w, "private upload details")
	}))
	defer server.Close()
	client, _ := NewClient("key", ClientOptions{BaseURL: server.URL, HTTPClient: server.Client()})
	file := File{ID: testFileID, Object: "file", Status: "pending_upload", Size: 3,
		Upload: &FileUpload{Type: "multipart", ExpiresAt: time.Now().Add(time.Minute).Unix(), Parts: []UploadPart{{PartNumber: 1, Size: 3, URL: server.URL}}}}
	_, err := client.UploadFile(context.Background(), file, strings.NewReader("abc"))
	if err == nil || calls != 1 || strings.Contains(err.Error(), "private") {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}

func TestCreateFilesRejectsInvalidMetadataLocally(t *testing.T) {
	client, _ := NewClient("key", ClientOptions{})
	for _, file := range []CreateFile{
		{Name: "a", MediaType: "image/png", Size: 0},
		{Name: "a", MediaType: "image/png", Size: 2147483649},
		{Name: "a", MediaType: "application/octet-stream", Size: 1},
		{Name: " ", MediaType: "image/png", Size: 1},
	} {
		if _, err := client.CreateFiles(context.Background(), CreateFilesRequest{Files: []CreateFile{file}}, "key"); err == nil {
			t.Fatal("invalid metadata accepted")
		}
	}
}

func TestUploadFileRejectsIncompleteOrChangedCompletion(t *testing.T) {
	file := File{ID: testFileID, Object: "file", Status: "pending_upload", Name: "frame.png", MediaType: "image/png", Size: 1}
	for _, field := range []string{"status", "name", "media_type", "size"} {
		t.Run(field, func(t *testing.T) {
			completed := file
			completed.Status = "ready"
			switch field {
			case "status":
				completed.Status = "pending_upload"
			case "name":
				completed.Name = "other.png"
			case "media_type":
				completed.MediaType = "image/jpeg"
			case "size":
				completed.Size = 2
			}
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPut {
					io.Copy(io.Discard, r.Body)
					w.WriteHeader(http.StatusOK)
					return
				}
				json.NewEncoder(w).Encode(completed)
			}))
			defer server.Close()
			client, err := NewClient("key", ClientOptions{BaseURL: server.URL, HTTPClient: server.Client()})
			if err != nil {
				t.Fatal(err)
			}
			pending := file
			pending.Upload = &FileUpload{Type: "multipart", ExpiresAt: time.Now().Add(time.Minute).Unix(), Parts: []UploadPart{{PartNumber: 1, Size: 1, URL: server.URL + "/part"}}}
			if _, err := client.UploadFile(context.Background(), pending, strings.NewReader("x")); err == nil || err.Error() != "response_invalid" {
				t.Fatalf("invalid completion accepted: %v", err)
			}
		})
	}
}

func TestWaitForFileReadyPollsUntilReady(t *testing.T) {
	calls := 0
	w := 1024
	h := 768
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		calls++
		status := "processing"
		var widthPtr, heightPtr *int
		if calls >= 3 {
			status = "ready"
			widthPtr = &w
			heightPtr = &h
		}
		json.NewEncoder(rw).Encode(File{
			ID:        testFileID,
			Object:    "file",
			Status:    status,
			Name:      "test.png",
			MediaType: "image/png",
			Size:      100,
			Width:     widthPtr,
			Height:    heightPtr,
		})
	}))
	defer server.Close()

	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}

	file, err := client.WaitForFileReady(context.Background(), testFileID, 2*time.Second)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if file.Status != "ready" || file.Width == nil || *file.Width != 1024 || file.Height == nil || *file.Height != 768 {
		t.Fatalf("unexpected ready file: %+v", file)
	}
	if calls < 3 {
		t.Fatalf("expected at least 3 calls, got %d", calls)
	}
}

func TestWaitForFileReadyReturnsErrorOnFailedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		json.NewEncoder(rw).Encode(File{
			ID:        testFileID,
			Object:    "file",
			Status:    "failed",
			Name:      "bad.png",
			MediaType: "image/png",
			Size:      100,
		})
	}))
	defer server.Close()

	client, err := NewClient("test-key", ClientOptions{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}

	_, err = client.WaitForFileReady(context.Background(), testFileID, 1*time.Second)
	if err == nil || err.Error() != "file_processing_failed" {
		t.Fatalf("expected file_processing_failed, got %v", err)
	}
}

func TestUploadFileWaitsWhenServerReturnsProcessing(t *testing.T) {
	uploadServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer uploadServer.Close()

	w := 1200
	h := 800
	getCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/files/" + testFileID + "/complete":
			// returns processing
			json.NewEncoder(rw).Encode(File{
				ID:        testFileID,
				Object:    "file",
				Status:    "processing",
				Name:      "frame.png",
				MediaType: "image/png",
				Size:      4,
			})
		case "/v1/files/" + testFileID:
			getCalls++
			status := "processing"
			var widthPtr, heightPtr *int
			if getCalls >= 2 {
				status = "ready"
				widthPtr = &w
				heightPtr = &h
			}
			json.NewEncoder(rw).Encode(File{
				ID:        testFileID,
				Object:    "file",
				Status:    status,
				Name:      "frame.png",
				MediaType: "image/png",
				Size:      4,
				Width:     widthPtr,
				Height:    heightPtr,
			})
		default:
			rw.WriteHeader(404)
		}
	}))
	defer server.Close()

	client, err := NewClient("key", ClientOptions{BaseURL: server.URL, HTTPClient: uploadServer.Client()})
	if err != nil {
		t.Fatal(err)
	}

	pending := File{
		ID:        testFileID,
		Object:    "file",
		Status:    "pending_upload",
		Name:      "frame.png",
		MediaType: "image/png",
		Size:      4,
		Upload: &FileUpload{
			Type:      "multipart",
			ExpiresAt: time.Now().Add(time.Minute).Unix(),
			Parts:     []UploadPart{{PartNumber: 1, Size: 4, URL: uploadServer.URL + "/part"}},
		},
	}

	ready, err := client.UploadFile(context.Background(), pending, strings.NewReader("1234"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ready.Status != "ready" || ready.Width == nil || *ready.Width != 1200 {
		t.Fatalf("unexpected ready file: %+v", ready)
	}
}

func TestGetFileContentURLReturnsSignedURLWithoutFollowingIt(t *testing.T) {
	signedHits := 0
	signed := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { signedHits++ }))
	defer signed.Close()
	signedURL := signed.URL + "/object?X-Signature=abc"
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/v1/files/"+testFileID+"/content" || r.Header.Get("Authorization") != "Bearer key" {
			t.Errorf("unexpected gateway request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Location", signedURL)
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer gateway.Close()
	client, err := NewClient("key", ClientOptions{BaseURL: gateway.URL, HTTPClient: signed.Client()})
	if err != nil {
		t.Fatal(err)
	}
	location, err := client.GetFileContentURL(context.Background(), testFileID)
	if err != nil || location != signedURL {
		t.Fatalf("got %q, %v", location, err)
	}
	if signedHits != 0 {
		t.Fatal("client followed the redirect and exposed the gateway key")
	}
}

func TestGetFileContentURLRejectsUnsafeResponses(t *testing.T) {
	for _, tc := range []struct {
		status   int
		location string
	}{
		{307, "http://storage.example/object"},
		{307, "https://user:pass@storage.example/object"},
		{307, "https://storage.example/object#fragment"},
		{307, "/relative/object"},
		{307, ""},
		{302, "https://storage.example/object"},
		{200, ""},
	} {
		gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if tc.location != "" {
				w.Header().Set("Location", tc.location)
			}
			w.WriteHeader(tc.status)
		}))
		client, _ := NewClient("key", ClientOptions{BaseURL: gateway.URL})
		location, err := client.GetFileContentURL(context.Background(), testFileID)
		gateway.Close()
		if err == nil || err.Error() != "file_content_response_invalid" || location != "" {
			t.Fatalf("%d %q: got %q, %v", tc.status, tc.location, location, err)
		}
		if strings.Contains(err.Error(), "storage.example") {
			t.Fatal("error exposed the signed URL")
		}
	}
	client, _ := NewClient("key", ClientOptions{BaseURL: "http://127.0.0.1:1"})
	if _, err := client.GetFileContentURL(context.Background(), "file_bad"); err == nil || err.Error() != "file_id_invalid" {
		t.Fatalf("invalid id accepted: %v", err)
	}
}

func TestGetFileContentURLMapsFileStateErrors(t *testing.T) {
	for status, code := range map[int]string{404: "YIR_FILE_NOT_FOUND", 409: "YIR_FILE_NOT_READY", 410: "YIR_FILE_EXPIRED"} {
		gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": code, "message": "x", "retryable": false}})
		}))
		client, _ := NewClient("key", ClientOptions{BaseURL: gateway.URL})
		_, err := client.GetFileContentURL(context.Background(), testFileID)
		gateway.Close()
		apiErr, ok := err.(*APIError)
		if !ok || apiErr.Status != status || apiErr.Code != code {
			t.Fatalf("%d: unexpected error %v", status, err)
		}
	}
}
