package server

import (
	"bytes"
	"context"
	"encoding/json"
	"image/color"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"trendlix.com/scan-helper/internal/config"
	"trendlix.com/scan-helper/internal/discovery"
	"trendlix.com/scan-helper/internal/escl"
	"trendlix.com/scan-helper/internal/escltest"
	"trendlix.com/scan-helper/internal/pdf"
)

const appOrigin = "https://people.trendlix.com"

type fakeBrowser struct{ services []discovery.Service }

func (b *fakeBrowser) Browse(ctx context.Context, window time.Duration) ([]discovery.Service, error) {
	return slices.Clone(b.services), nil
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

type env struct {
	t     *testing.T
	http  *httptest.Server
	store *config.Store
	dir   string
	logs  *syncBuffer
}

type envOptions struct {
	services     []discovery.Service
	origins      []string
	scanTimeout  time.Duration
	pollInterval time.Duration
}

func newEnv(t *testing.T, o envOptions) *env {
	t.Helper()
	dir := t.TempDir()
	if len(o.origins) > 0 {
		data, _ := json.Marshal(config.Config{AllowedOrigins: o.origins})
		if err := os.WriteFile(filepath.Join(dir, "config.json"), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	logs := &syncBuffer{}
	logger := log.New(logs, "", 0)
	store, err := config.Open(dir, logger.Printf)
	if err != nil {
		t.Fatal(err)
	}
	client := escl.NewClient("test")
	client.PollInterval = 20 * time.Millisecond
	if o.pollInterval > 0 {
		client.PollInterval = o.pollInterval
	}
	reg := NewRegistry(&fakeBrowser{o.services}, client, store, logger)
	reg.BrowseWindow = 10 * time.Millisecond
	reg.CapsWait = 3 * time.Second
	reg.ListWait = 3 * time.Second
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	reg.Start(ctx)
	if o.scanTimeout == 0 {
		o.scanTimeout = 10 * time.Second
	}
	srv := New(Options{Version: "1.0.0", Registry: reg, Client: client, Config: store, Log: logger, ScanTimeout: o.scanTimeout, LogPath: filepath.Join(dir, "helper.log")})
	hs := httptest.NewServer(srv.Handler())
	t.Cleanup(hs.Close)
	return &env{t: t, http: hs, store: store, dir: dir, logs: logs}
}

func (e *env) do(method, path, origin string, body any, headers ...string) *http.Response {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		rd = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, e.http.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		if headers[i] == "Host" {
			req.Host = headers[i+1]
		} else {
			req.Header.Set(headers[i], headers[i+1])
		}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	e.t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func readAll(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func errorOf(t *testing.T, resp *http.Response) string {
	t.Helper()
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(readAll(t, resp), &body); err != nil {
		t.Fatalf("error body isn't JSON: %v", err)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("error Content-Type = %q", ct)
	}
	return body.Error
}

func serviceFor(t *testing.T, f *escltest.Scanner, secure bool) discovery.Service {
	t.Helper()
	u, _ := url.Parse(f.URL())
	port, _ := strconv.Atoi(u.Port())
	return discovery.Service{
		Instance: "HP LaserJet MFP M428fdw (9F1234)",
		Secure:   secure,
		Host:     "NPI9F1234.local",
		IPv4:     net.ParseIP("127.0.0.1").To4(),
		Port:     port,
		TXT: map[string]string{
			"ty": "HP LaserJet MFP M428fdw", "rs": "eSCL", "uuid": "564e4333-4c30-3846-3434-a0481c9f1234",
			"is": "platen,adf", "cs": "color,grayscale,binary", "pdl": "application/pdf,image/jpeg", "duplex": "T",
		},
	}
}

func (e *env) scanners() []Scanner {
	e.t.Helper()
	resp := e.do("GET", "/v1/scanners", appOrigin, nil)
	if resp.StatusCode != 200 {
		e.t.Fatalf("GET /v1/scanners = %d", resp.StatusCode)
	}
	var list []Scanner
	if err := json.Unmarshal(readAll(e.t, resp), &list); err != nil {
		e.t.Fatal(err)
	}
	return list
}

// discoveredEnv is a helper with one fake scanner found by "mDNS".
func discoveredEnv(t *testing.T, f *escltest.Scanner, o envOptions) (*env, Scanner) {
	t.Helper()
	f.Start(false)
	t.Cleanup(f.Close)
	o.services = []discovery.Service{serviceFor(t, f, false)}
	e := newEnv(t, o)
	list := e.scanners()
	if len(list) != 1 {
		t.Fatalf("scanners = %+v", list)
	}
	return e, list[0]
}

func TestStatus(t *testing.T) {
	e := newEnv(t, envOptions{})
	resp := e.do("GET", "/v1/status", "", nil)
	if got := string(readAll(t, resp)); resp.StatusCode != 200 || got != `{"app":"trendlix-scan-helper","version":"1.0.0"}`+"\n" {
		t.Errorf("status = %d %q", resp.StatusCode, got)
	}
}

func TestListScanners(t *testing.T) {
	f := &escltest.Scanner{}
	_, sc := discoveredEnv(t, f, envOptions{})
	want := Scanner{
		ID: ScannerID(f.BaseURL()), Name: "HP LaserJet MFP M428fdw", URL: f.BaseURL(), Secure: false,
		Sources: []string{"platen", "feeder"}, Duplex: true, ColorModes: []string{"color", "grayscale", "bw"},
		Resolutions: []int{75, 100, 200, 300, 600}, Formats: []string{"application/octet-stream", "image/jpeg", "application/pdf"},
		Manual: false,
	}
	got, _ := json.Marshal(sc)
	exp, _ := json.Marshal(want)
	if string(got) != string(exp) {
		t.Errorf("scanner =\n%s\nwant\n%s", got, exp)
	}
	if !regexp.MustCompile(`^[0-9a-f]{12}$`).MatchString(sc.ID) {
		t.Errorf("id %q", sc.ID)
	}
}

func TestListIsEmptyArray(t *testing.T) {
	e := newEnv(t, envOptions{})
	resp := e.do("GET", "/v1/scanners?refresh=1", appOrigin, nil)
	if got := strings.TrimSpace(string(readAll(t, resp))); got != "[]" {
		t.Errorf("body = %q, want []", got)
	}
}

func checkPDF(t *testing.T, resp *http.Response, pages int) []byte {
	t.Helper()
	body := readAll(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("scan = %d %s", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q", ct)
	}
	if got := resp.Header.Get("X-Scan-Pages"); got != strconv.Itoa(pages) {
		t.Errorf("X-Scan-Pages = %q, want %d", got, pages)
	}
	if cd := resp.Header.Get("Content-Disposition"); !regexp.MustCompile(`^attachment; filename="scan-\d{8}-\d{6}\.pdf"$`).MatchString(cd) {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if !pdf.IsPDF(body) {
		t.Fatal("body isn't a PDF")
	}
	if got := pdf.CountPages(body); got != pages {
		t.Errorf("PDF pages = %d, want %d", got, pages)
	}
	return body
}

func TestPlatenScan(t *testing.T) {
	f := &escltest.Scanner{}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "platen", "duplex": false, "colorMode": "color", "resolution": 300})
	checkPDF(t, resp, 1)
	if resp.Header.Get("Access-Control-Allow-Origin") != appOrigin {
		t.Error("missing CORS header on the scan response")
	}
	settings := f.Settings()
	if len(settings) != 1 {
		t.Fatalf("jobs = %d", len(settings))
	}
	for _, want := range []string{
		"<pwg:Version>2.63</pwg:Version>", "<scan:Intent>Document</scan:Intent>",
		"<pwg:InputSource>Platen</pwg:InputSource>", "<scan:ColorMode>RGB24</scan:ColorMode>",
		"<scan:XResolution>300</scan:XResolution>", "<scan:YResolution>300</scan:YResolution>",
		"<scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>",
		"<pwg:Width>2480</pwg:Width>", "<pwg:Height>3508</pwg:Height>",
		"<pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>",
	} {
		if !strings.Contains(settings[0], want) {
			t.Errorf("ScanSettings lacks %s:\n%s", want, settings[0])
		}
	}
	if strings.Contains(settings[0], "Duplex") {
		t.Error("platen settings shouldn't mention Duplex")
	}
	if logs := e.logs.String(); !strings.Contains(logs, "scan started") || !strings.Contains(logs, "scan finished") || len(logs) > 4000 {
		t.Errorf("logs: %s", logs)
	}
}

func TestFeederScanThreePages(t *testing.T) {
	f := &escltest.Scanner{FeederPages: 3}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "feeder", "colorMode": "grayscale", "resolution": 300})
	checkPDF(t, resp, 3)
	s := f.Settings()[0]
	for _, want := range []string{"<pwg:InputSource>Feeder</pwg:InputSource>", "<scan:ColorMode>Grayscale8</scan:ColorMode>", "<scan:Duplex>false</scan:Duplex>", "<pwg:Height>3508</pwg:Height>"} {
		if !strings.Contains(s, want) {
			t.Errorf("ScanSettings lacks %s:\n%s", want, s)
		}
	}
	if len(f.Deleted()) != 0 {
		t.Error("a successful scan shouldn't cancel its job")
	}
}

func TestDuplexFeederScan(t *testing.T) {
	f := &escltest.Scanner{FeederPages: 4}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "feeder", "duplex": true, "colorMode": "bw", "resolution": 600})
	checkPDF(t, resp, 4)
	s := f.Settings()[0]
	for _, want := range []string{"<scan:Duplex>true</scan:Duplex>", "<scan:ColorMode>BlackAndWhite1</scan:ColorMode>", "<scan:XResolution>300</scan:XResolution>"} {
		if !strings.Contains(s, want) {
			t.Errorf("ScanSettings lacks %s:\n%s", want, s)
		}
	}
}

func TestScanBusy(t *testing.T) {
	f := &escltest.Scanner{JobStatus: http.StatusServiceUnavailable}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "platen"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if got := errorOf(t, resp); got != "The scanner is busy. Try again in a moment." {
		t.Errorf("error = %q", got)
	}
}

func TestScanFeederEmptyFromStatus(t *testing.T) {
	f := &escltest.Scanner{AdfEmpty: true, FeederPages: 3}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "feeder"})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if got := errorOf(t, resp); got != "The document feeder is empty. Put the pages in the feeder, or scan from the glass." {
		t.Errorf("error = %q", got)
	}
	if len(f.Settings()) != 0 {
		t.Error("no job should be created when the feeder is known to be empty")
	}
}

func TestScanFeederEmptyNoPages(t *testing.T) {
	f := &escltest.Scanner{FeederPages: 0}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "feeder"})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if len(f.Deleted()) != 1 {
		t.Errorf("the job should be cancelled, deleted = %v", f.Deleted())
	}
}

func TestScanTimeout(t *testing.T) {
	f := &escltest.Scanner{PageDelay: 5 * time.Second}
	e, sc := discoveredEnv(t, f, envOptions{scanTimeout: 300 * time.Millisecond})
	start := time.Now()
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "platen"})
	if resp.StatusCode != http.StatusGatewayTimeout {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if got := errorOf(t, resp); !strings.HasPrefix(got, "The scan took more than 0.3 seconds") {
		t.Errorf("error = %q", got)
	}
	if time.Since(start) > 3*time.Second {
		t.Error("the timeout didn't stop the scan in time")
	}
	if len(f.Deleted()) != 1 {
		t.Errorf("the job should be cancelled, deleted = %v", f.Deleted())
	}
}

func TestScanTimeoutMessageDefault(t *testing.T) {
	if got := humanDuration(DefaultScanTimeout); got != "2 minutes" {
		t.Errorf("humanDuration = %q", got)
	}
}

func TestScanScannerError(t *testing.T) {
	f := &escltest.Scanner{JobStatus: http.StatusBadRequest}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "platen"})
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if got := errorOf(t, resp); !strings.HasPrefix(got, "The scanner reported an error: ") {
		t.Errorf("error = %q", got)
	}
}

func TestScanRequestProblems(t *testing.T) {
	f := &escltest.Scanner{Capabilities: escltest.PlatenPDFCapabilities}
	e, sc := discoveredEnv(t, f, envOptions{})
	cases := []struct {
		body   map[string]any
		status int
	}{
		{map[string]any{"scannerId": "000000000000"}, 404},
		{map[string]any{"scannerId": sc.ID, "source": "feeder"}, 400},
		{map[string]any{"scannerId": sc.ID, "source": "camera"}, 400},
		{map[string]any{"scannerId": sc.ID, "colorMode": "sepia"}, 400},
		{map[string]any{"scannerId": sc.ID, "resolution": -5}, 400},
		{map[string]any{}, 400},
	}
	for _, c := range cases {
		resp := e.do("POST", "/v1/scan", appOrigin, c.body)
		if resp.StatusCode != c.status {
			t.Errorf("%v: status = %d, want %d", c.body, resp.StatusCode, c.status)
		}
		if msg := errorOf(t, resp); msg == "" {
			t.Errorf("%v: no error message", c.body)
		}
	}
}

func TestScanPDFOnlyScannerPassesPDFThrough(t *testing.T) {
	var two bytes.Buffer
	img, _ := pdf.ParseJPEG(escltest.JPEG(100, 140, color.Gray{Y: 90}))
	if err := pdf.Write(&two, []pdf.Image{img, img}, pdf.Options{}); err != nil {
		t.Fatal(err)
	}
	f := &escltest.Scanner{Capabilities: escltest.PlatenPDFCapabilities, PageType: "application/pdf", Page: func(int) []byte { return two.Bytes() }}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "platen", "colorMode": "color", "resolution": 300})
	body := checkPDF(t, resp, 2)
	if !bytes.Equal(body, two.Bytes()) {
		t.Error("the scanner's PDF should be passed through unchanged")
	}
	if !strings.Contains(f.Settings()[0], "<scan:DocumentFormatExt>application/pdf</scan:DocumentFormatExt>") {
		t.Error("should ask for PDF")
	}
}

func TestCORS(t *testing.T) {
	e := newEnv(t, envOptions{origins: []string{"https://staging.trendlix.com/"}})
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(e.http.URL, "http://"))

	allowed := []string{"https://people.trendlix.com", "http://localhost:3000", "https://staging.trendlix.com", "http://127.0.0.1:" + port}
	for _, o := range allowed {
		resp := e.do("GET", "/v1/status", o, nil)
		if resp.StatusCode != 200 {
			t.Errorf("%s: status %d", o, resp.StatusCode)
		}
		h := resp.Header
		if h.Get("Access-Control-Allow-Origin") != o {
			t.Errorf("%s: Allow-Origin = %q", o, h.Get("Access-Control-Allow-Origin"))
		}
		if h.Get("Access-Control-Allow-Private-Network") != "true" {
			t.Errorf("%s: no Allow-Private-Network", o)
		}
		if exp := h.Get("Access-Control-Expose-Headers"); !strings.Contains(exp, "X-Scan-Pages") || !strings.Contains(exp, "Content-Disposition") {
			t.Errorf("%s: Expose-Headers = %q", o, exp)
		}
		if !slices.Contains(h.Values("Vary"), "Origin") {
			t.Errorf("%s: no Vary: Origin", o)
		}
	}

	// Preflight, including Chrome's Private Network Access request header.
	resp := e.do("OPTIONS", "/v1/scan", appOrigin, nil,
		"Access-Control-Request-Method", "POST",
		"Access-Control-Request-Headers", "content-type",
		"Access-Control-Request-Private-Network", "true")
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("preflight status = %d", resp.StatusCode)
	}
	for k, v := range map[string]string{
		"Access-Control-Allow-Origin":          appOrigin,
		"Access-Control-Allow-Methods":         "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers":         "Content-Type",
		"Access-Control-Allow-Private-Network": "true",
	} {
		if got := resp.Header.Get(k); got != v {
			t.Errorf("preflight %s = %q, want %q", k, got, v)
		}
	}

	// Other websites are refused, for reads, preflights and actions.
	for _, method := range []string{"GET", "OPTIONS", "POST", "DELETE"} {
		for _, o := range []string{"https://evil.example", "null", "https://people.trendlix.com.evil.example", "http://localhost:3001"} {
			path := "/v1/scanners"
			if method == "DELETE" {
				path = "/v1/scanners/abc"
			}
			resp := e.do(method, path, o, map[string]string{"url": "192.168.1.50"})
			if resp.StatusCode != http.StatusForbidden {
				t.Errorf("%s from %s: status %d, want 403", method, o, resp.StatusCode)
			}
			if resp.Header.Get("Access-Control-Allow-Origin") != "" || resp.Header.Get("Access-Control-Allow-Private-Network") != "" {
				t.Errorf("%s from %s: CORS headers on a refusal", method, o)
			}
			if msg := errorOf(t, resp); msg == "" {
				t.Errorf("%s from %s: no error message", method, o)
			}
		}
	}

	// No Origin: reading is fine (status page, curl), actions are refused.
	if resp := e.do("GET", "/v1/status", "", nil); resp.StatusCode != 200 {
		t.Errorf("GET without Origin = %d", resp.StatusCode)
	}
	for _, m := range []struct{ method, path string }{{"POST", "/v1/scan"}, {"POST", "/v1/scanners"}, {"DELETE", "/v1/scanners/abc"}, {"OPTIONS", "/v1/scan"}} {
		if resp := e.do(m.method, m.path, "", map[string]string{}); resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s %s without Origin = %d, want 403", m.method, m.path, resp.StatusCode)
		}
	}

	// DNS rebinding: a foreign Host name is refused even from an allowed origin.
	if resp := e.do("GET", "/v1/status", appOrigin, nil, "Host", "evil.example:47815"); resp.StatusCode != http.StatusForbidden {
		t.Errorf("foreign Host = %d, want 403", resp.StatusCode)
	}
	if resp := e.do("GET", "/v1/status", "", nil, "Host", "localhost:47815"); resp.StatusCode != 200 {
		t.Errorf("localhost Host = %d, want 200", resp.StatusCode)
	}
}

func TestAddAndRemoveManualScanner(t *testing.T) {
	f := (&escltest.Scanner{}).Start(false)
	defer f.Close()
	e := newEnv(t, envOptions{})

	resp := e.do("POST", "/v1/scanners", appOrigin, map[string]string{"url": f.HostPort()})
	body := readAll(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("add = %d %s", resp.StatusCode, body)
	}
	var sc Scanner
	if err := json.Unmarshal(body, &sc); err != nil {
		t.Fatal(err)
	}
	if !sc.Manual || sc.URL != f.BaseURL() || sc.Secure || sc.Name != "HP LaserJet MFP M428fdw" || sc.ID != ScannerID(f.BaseURL()) || !sc.Duplex {
		t.Errorf("added scanner = %+v", sc)
	}
	cfg, _ := os.ReadFile(filepath.Join(e.dir, "config.json"))
	if !strings.Contains(string(cfg), f.BaseURL()) {
		t.Errorf("config.json doesn't list the scanner:\n%s", cfg)
	}
	if list := e.scanners(); len(list) != 1 || list[0].ID != sc.ID || !list[0].Manual {
		t.Errorf("list = %+v", list)
	}

	// Adding it again is harmless.
	if resp := e.do("POST", "/v1/scanners", appOrigin, map[string]string{"url": f.BaseURL()}); resp.StatusCode != 200 {
		t.Errorf("re-add = %d", resp.StatusCode)
	}
	if len(e.store.Snapshot().Scanners) != 1 {
		t.Errorf("scanners saved = %+v", e.store.Snapshot().Scanners)
	}

	// It can be scanned from.
	checkPDF(t, e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID}), 1)

	resp = e.do("DELETE", "/v1/scanners/"+sc.ID, appOrigin, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("delete = %d %s", resp.StatusCode, readAll(t, resp))
	}
	if list := e.scanners(); len(list) != 0 {
		t.Errorf("list after delete = %+v", list)
	}
	if resp := e.do("DELETE", "/v1/scanners/"+sc.ID, appOrigin, nil); resp.StatusCode != 404 {
		t.Errorf("second delete = %d, want 404", resp.StatusCode)
	}
}

func TestAddManualScannerOverHTTPS(t *testing.T) {
	f := (&escltest.Scanner{}).Start(true)
	defer f.Close()
	e := newEnv(t, envOptions{})
	resp := e.do("POST", "/v1/scanners", appOrigin, map[string]string{"url": f.HostPort()})
	body := readAll(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("add = %d %s", resp.StatusCode, body)
	}
	var sc Scanner
	json.Unmarshal(body, &sc)
	if !sc.Secure || !strings.HasPrefix(sc.URL, "https://") {
		t.Errorf("scanner = %+v, want the HTTPS endpoint", sc)
	}
	checkPDF(t, e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID}), 1)
}

func TestAddManualScannerFailures(t *testing.T) {
	e := newEnv(t, envOptions{})

	// Nothing listening there.
	ln, _ := net.Listen("tcp4", "127.0.0.1:0")
	closed := ln.Addr().String()
	ln.Close()
	resp := e.do("POST", "/v1/scanners", appOrigin, map[string]string{"url": closed})
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("closed port = %d", resp.StatusCode)
	}
	if msg := errorOf(t, resp); !strings.HasPrefix(msg, "No scanner answered at "+closed) {
		t.Errorf("closed port message = %q", msg)
	}

	// A web server that isn't a scanner.
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<html>router admin</html>"))
	}))
	defer web.Close()
	resp = e.do("POST", "/v1/scanners", appOrigin, map[string]string{"url": web.URL})
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("web server = %d", resp.StatusCode)
	}
	if msg := errorOf(t, resp); !strings.Contains(msg, "doesn't look like a network scanner") {
		t.Errorf("web server message = %q", msg)
	}

	for _, bad := range []string{"", "   ", "ftp://192.168.1.50", "not a host"} {
		if resp := e.do("POST", "/v1/scanners", appOrigin, map[string]string{"url": bad}); resp.StatusCode != 400 {
			t.Errorf("%q = %d, want 400", bad, resp.StatusCode)
		}
	}
	if len(e.store.Snapshot().Scanners) != 0 {
		t.Error("nothing should be saved")
	}
}

func TestRemoveDiscoveredScannerRefused(t *testing.T) {
	f := &escltest.Scanner{}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("DELETE", "/v1/scanners/"+sc.ID, appOrigin, nil)
	if resp.StatusCode != 400 {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestHTTPAndHTTPSAdvertisementsShowOnce(t *testing.T) {
	plain := (&escltest.Scanner{}).Start(false)
	defer plain.Close()
	secure := (&escltest.Scanner{}).Start(true)
	defer secure.Close()
	e := newEnv(t, envOptions{services: []discovery.Service{serviceFor(t, plain, false), serviceFor(t, secure, true)}})
	list := e.scanners()
	if len(list) != 1 || !list[0].Secure || list[0].URL != secure.BaseURL() {
		t.Errorf("list = %+v, want only the HTTPS endpoint", list)
	}
}

func TestCandidateURLs(t *testing.T) {
	cases := map[string][]string{
		"192.168.1.50":                {"http://192.168.1.50/eSCL", "https://192.168.1.50/eSCL"},
		" 192.168.1.50:8080 ":         {"http://192.168.1.50:8080/eSCL", "https://192.168.1.50:8080/eSCL"},
		"Scanner.local":               {"http://scanner.local/eSCL", "https://scanner.local/eSCL"},
		"http://192.168.1.50/eSCL/":   {"http://192.168.1.50/eSCL"},
		"https://192.168.1.50":        {"https://192.168.1.50/eSCL"},
		"http://192.168.1.50:80/escl": {"http://192.168.1.50:80/escl"},
	}
	for in, want := range cases {
		if got, err := CandidateURLs(in); err != nil || !slices.Equal(got, want) {
			t.Errorf("CandidateURLs(%q) = %v, %v; want %v", in, got, err, want)
		}
	}
	for _, in := range []string{"", "a b", "ftp://192.168.1.50", "http://user:pw@192.168.1.50/x", "http://"} {
		if got, err := CandidateURLs(in); err == nil {
			t.Errorf("CandidateURLs(%q) = %v, want an error", in, got)
		}
	}
}

func TestStatusPage(t *testing.T) {
	f := &escltest.Scanner{}
	e, _ := discoveredEnv(t, f, envOptions{})
	resp := e.do("GET", "/", "", nil)
	body := string(readAll(t, resp))
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
		t.Fatalf("status page = %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	for _, want := range []string{"TrendLIX Scan Helper", "version 1.0.0", "HP LaserJet MFP M428fdw", "Add a scanner by its IP address", "How to stop the helper"} {
		if !strings.Contains(body, want) {
			t.Errorf("status page lacks %q", want)
		}
	}
	if resp := e.do("GET", "/nope", "", nil); resp.StatusCode != 404 {
		t.Errorf("unknown path = %d", resp.StatusCode)
	}
}

func TestListenBindsLoopbackOnly(t *testing.T) {
	ln, err := Listen(0)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	addr := ln.Addr().(*net.TCPAddr)
	if !addr.IP.Equal(net.IPv4(127, 0, 0, 1)) {
		t.Fatalf("listening on %v, want 127.0.0.1", addr.IP)
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	// The port must not be reachable through this computer's other addresses.
	addrs, _ := net.InterfaceAddrs()
	tried := 0
	for _, a := range addrs {
		ipn, ok := a.(*net.IPNet)
		if !ok || ipn.IP.IsLoopback() || ipn.IP.To4() == nil {
			continue
		}
		tried++
		c, err := net.DialTimeout("tcp4", net.JoinHostPort(ipn.IP.String(), strconv.Itoa(addr.Port)), time.Second)
		if err == nil {
			c.Close()
			t.Errorf("the helper's port answered on %v", ipn.IP)
		}
	}
	if tried == 0 {
		t.Log("no non-loopback IPv4 address to try")
	}
}

func TestProbeHelper(t *testing.T) {
	e := newEnv(t, envOptions{})
	_, portStr, _ := net.SplitHostPort(strings.TrimPrefix(e.http.URL, "http://"))
	port, _ := strconv.Atoi(portStr)
	if v, ok := ProbeHelper(port); !ok || v != "1.0.0" {
		t.Errorf("ProbeHelper = %q %v", v, ok)
	}
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"app":"something-else"}`))
	}))
	defer other.Close()
	_, portStr, _ = net.SplitHostPort(strings.TrimPrefix(other.URL, "http://"))
	port, _ = strconv.Atoi(portStr)
	if _, ok := ProbeHelper(port); ok {
		t.Error("another program was taken for the helper")
	}
}
