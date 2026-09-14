package yir

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

type CreateFile struct {
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Size      int64  `json:"size"`
}

type CreateFilesRequest struct {
	Files      []CreateFile `json:"files"`
	UploadMode string       `json:"upload_mode,omitempty"`
}

type File struct {
	ID        string      `json:"id"`
	Object    string      `json:"object"`
	Status    string      `json:"status"`
	Name      string      `json:"name"`
	MediaType string      `json:"media_type"`
	Size      int64       `json:"size"`
	Upload    *FileUpload `json:"upload,omitempty"`
	URL       string      `json:"url,omitempty"`
	ExpiresAt int64       `json:"expires_at,omitempty"`
}

type FileUpload struct {
	Type      string       `json:"type"`
	Parts     []UploadPart `json:"parts"`
	ExpiresAt int64        `json:"expires_at"`
}

type UploadPart struct {
	PartNumber int    `json:"part_number"`
	Size       int64  `json:"size"`
	URL        string `json:"url"`
}

// CreateAndUploadFile prepares one replayable input file. Persist key before
// calling and reuse it with the same metadata and bytes after an interrupted call.
// A ready replay is returned without uploading again; failed/expired files require
// a new preparation rather than silently changing this idempotent identity.
func (c *Client) CreateAndUploadFile(ctx context.Context, metadata CreateFile, source io.ReaderAt, key string) (File, error) {
	if source == nil {
		return File{}, errors.New("upload_source_required")
	}
	metadata = normalizeCreateFile(metadata)
	files, err := c.CreateFiles(ctx, CreateFilesRequest{Files: []CreateFile{metadata}, UploadMode: "multipart"}, key)
	if err != nil {
		return File{}, err
	}
	file := files[0]
	switch file.Status {
	case "ready":
		return file, nil
	case "pending_upload":
		ready, err := c.UploadFile(ctx, file, source)
		if err != nil {
			return File{}, err
		}
		if ready.Status != "ready" || ready.Name != metadata.Name || ready.MediaType != metadata.MediaType || ready.Size != metadata.Size {
			return File{}, errors.New("response_invalid")
		}
		return ready, nil
	default:
		return File{}, errors.New("file_not_ready")
	}
}

func (c *Client) CreateFiles(ctx context.Context, request CreateFilesRequest, key string) ([]File, error) {
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 255 || strings.ContainsAny(key, "\r\n") {
		return nil, errors.New("idempotency_key_invalid")
	}
	if len(request.Files) == 0 || len(request.Files) > 20 {
		return nil, errors.New("file_count_invalid")
	}
	if request.UploadMode != "" && request.UploadMode != "auto" && request.UploadMode != "multipart" {
		return nil, errors.New("upload_mode_invalid")
	}
	request.Files = append([]CreateFile(nil), request.Files...)
	for index := range request.Files {
		file := normalizeCreateFile(request.Files[index])
		request.Files[index] = file
		if file.Name == "" || !utf8.ValidString(file.Name) || len(file.Name) > 255 || strings.ContainsAny(file.Name, `/\`) ||
			strings.IndexFunc(file.Name, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 || file.Size < 1 || file.Size > 2147483648 {
			return nil, errors.New("file_metadata_invalid")
		}
		switch file.MediaType {
		case "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/wav":
		default:
			return nil, errors.New("file_media_type_invalid")
		}
	}
	var result struct {
		Files []File `json:"files"`
	}
	if err := c.do(ctx, http.MethodPost, "/v1/files", key, request, &result); err != nil {
		return nil, err
	}
	if len(result.Files) != len(request.Files) {
		return nil, errors.New("response_invalid")
	}
	for i, file := range result.Files {
		if !validFile(file) || file.Name != request.Files[i].Name || file.MediaType != request.Files[i].MediaType || file.Size != request.Files[i].Size {
			return nil, errors.New("response_invalid")
		}
	}
	return result.Files, nil
}

func normalizeCreateFile(file CreateFile) CreateFile {
	file.Name = strings.TrimSpace(file.Name)
	file.MediaType = strings.ToLower(strings.TrimSpace(file.MediaType))
	return file
}

func validFile(file File) bool {
	return fileIDPattern.MatchString(file.ID) && file.Object == "file" &&
		(file.Status == "pending_upload" || file.Status == "ready" || file.Status == "expired" || file.Status == "failed")
}

func (c *Client) GetFile(ctx context.Context, id string) (File, error) {
	return c.fileRequest(ctx, http.MethodGet, id, "", nil)
}

func (c *Client) CompleteFile(ctx context.Context, id string) (File, error) {
	return c.fileRequest(ctx, http.MethodPost, id, "/complete", struct{}{})
}

func (c *Client) fileRequest(ctx context.Context, method, id, suffix string, body any) (File, error) {
	var file File
	if !fileIDPattern.MatchString(id) {
		return file, errors.New("file_id_invalid")
	}
	err := c.do(ctx, method, "/v1/files/"+id+suffix, "", body, &file)
	if err == nil && (!validFile(file) || file.ID != id) {
		err = errors.New("response_invalid")
	}
	return file, err
}

// UploadFile streams a previously created upload plan, then asks Gateway to
// verify completion. It never forwards the Gateway Bearer key to upload URLs.
// ReaderAt supports large local files without buffering them in memory.
func (c *Client) UploadFile(ctx context.Context, file File, source io.ReaderAt) (File, error) {
	if c == nil || c.httpClient == nil {
		return file, errors.New("client_uninitialized")
	}
	if source == nil || !validFile(file) || file.Status != "pending_upload" || file.Upload == nil || file.Upload.Type != "multipart" ||
		file.Size < 1 || file.Size > 2147483648 || len(file.Upload.Parts) == 0 || file.Upload.ExpiresAt <= time.Now().Unix() {
		return file, errors.New("upload_plan_invalid")
	}
	var total int64
	for i, part := range file.Upload.Parts {
		u, err := url.Parse(part.URL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || part.PartNumber != i+1 || part.Size < 1 || part.Size > file.Size-total {
			return file, errors.New("upload_plan_invalid")
		}
		total += part.Size
	}
	if total != file.Size {
		return file, errors.New("upload_plan_invalid")
	}
	var offset int64
	for _, part := range file.Upload.Parts {
		request, err := http.NewRequestWithContext(ctx, http.MethodPut, part.URL, io.NewSectionReader(source, offset, part.Size))
		if err != nil {
			return file, errors.New("upload_plan_invalid")
		}
		request.ContentLength = part.Size
		result, err := c.httpClient.Do(request)
		if err != nil {
			if ctx.Err() != nil {
				return file, ctx.Err()
			}
			// Transport errors may contain the signed URL. Do not expose it.
			return file, errors.New("upload_transport_failed")
		}
		io.Copy(io.Discard, io.LimitReader(result.Body, 65536))
		result.Body.Close()
		if result.StatusCode < 200 || result.StatusCode >= 300 {
			return file, &APIError{Status: result.StatusCode, Code: "upload_failed"}
		}
		offset += part.Size
	}
	ready, err := c.CompleteFile(ctx, file.ID)
	if err != nil {
		return File{}, err
	}
	if ready.Status != "ready" || ready.Name != file.Name || ready.MediaType != file.MediaType || ready.Size != file.Size {
		return File{}, errors.New("response_invalid")
	}
	return ready, nil
}
