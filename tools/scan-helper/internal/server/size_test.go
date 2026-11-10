package server

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"trendlix.com/scan-helper/internal/escltest"
	"trendlix.com/scan-helper/internal/paper"
	"trendlix.com/scan-helper/internal/wia"
)

// A network scanner is asked the size as its scan region, from the origin
// corner; no size is A4, as before.
func TestNetworkScanSizes(t *testing.T) {
	f := &escltest.Scanner{FeederPages: 1}
	e, sc := discoveredEnv(t, f, envOptions{}) // glass 2550 x 3508, feeder 2550 x 4200
	cases := []struct {
		size   any
		source string
		w, h   string
	}{
		{nil, "platen", "2480", "3508"},
		{"A4", "platen", "2480", "3508"},
		{"A5", "platen", "1748", "2480"},
		{"a5", "platen", "1748", "2480"},
		{"Letter", "platen", "2550", "3300"},
		{map[string]any{"widthMm": 100, "heightMm": 150}, "platen", "1181", "1772"},
		{map[string]any{"widthMm": 400, "heightMm": 500}, "platen", "2550", "3508"}, // larger than the glass
		{"A5", "feeder", "1748", "2480"},
		{map[string]any{"widthMm": 20, "heightMm": 20}, "feeder", "591", "591"}, // the feeder's smallest page
	}
	for i, c := range cases {
		body := map[string]any{"scannerId": sc.ID, "source": c.source, "output": "images"}
		if c.size != nil {
			body["size"] = c.size
		}
		ans := checkImages(t, e.do("POST", "/v1/scan", primeOrigin, body), 1)
		if ans.Warning != "" {
			t.Errorf("%v: warning %q", c.size, ans.Warning)
		}
		s := f.Settings()[i]
		for _, want := range []string{"<pwg:Width>" + c.w + "</pwg:Width>", "<pwg:Height>" + c.h + "</pwg:Height>", "<pwg:XOffset>0</pwg:XOffset>", "<pwg:YOffset>0</pwg:YOffset>"} {
			if !strings.Contains(s, want) {
				t.Errorf("%v on the %s: ScanSettings lack %s:\n%s", c.size, c.source, want, s)
			}
		}
	}
	if logs := e.logs.String(); !strings.Contains(logs, "A5 (1748 x 2480)") || !strings.Contains(logs, "100 x 150 mm (1181 x 1772)") {
		t.Errorf("logs: %s", logs)
	}
}

func TestScanSizeProblems(t *testing.T) {
	f := &escltest.Scanner{}
	e, sc := discoveredEnv(t, f, envOptions{})
	cases := []struct {
		size any
		msg  string
	}{
		{"A3", msgSizeUnknown},
		{"Legal", msgSizeUnknown},
		{210, msgSizeUnknown},
		{[]int{148, 210}, msgSizeUnknown},
		{map[string]any{"widthMm": 5, "heightMm": 5}, msgSizeBad},
		{map[string]any{"widthMm": 148}, msgSizeBad},
		{map[string]any{"widthMm": 148, "heightMm": 2000}, msgSizeBad},
		{map[string]any{"width": 148, "height": 210}, msgSizeBad},
	}
	for _, c := range cases {
		resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "size": c.size})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%v: status = %d", c.size, resp.StatusCode)
		}
		if msg := errorOf(t, resp); msg != c.msg {
			t.Errorf("%v: error = %q, want %q", c.size, msg, c.msg)
		}
	}
	// The size is checked before anything else is asked of the scanner.
	if resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": "000000000000", "size": "A3"}); resp.StatusCode != 400 {
		t.Errorf("unknown scanner with a bad size = %d, want 400", resp.StatusCode)
	}
	if n := len(f.Settings()); n != 0 {
		t.Errorf("%d scans started", n)
	}
}

func TestLocalScanSizes(t *testing.T) {
	local := newFakeLocal()
	e := newEnv(t, envOptions{local: local})

	checkPDF(t, e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(lideID), "size": "A5"}), 1)
	if c := local.lastCall(t); c.Settings != (wia.Settings{Source: "platen", ColorMode: "color", Resolution: 300, Size: paper.A5}) {
		t.Errorf("settings = %+v", c.Settings)
	}
	checkPDF(t, e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(lideID), "size": map[string]any{"widthMm": 85.6, "heightMm": 54}}), 1)
	if c := local.lastCall(t); c.Settings.Size != (paper.Size{W: 8560, H: 5400}) {
		t.Errorf("size = %+v", c.Settings.Size)
	}
	if logs := e.logs.String(); !strings.Contains(logs, `scan started on "Canon LiDE 300" (installed in Windows): platen, color, 300 dpi, A5`) {
		t.Errorf("logs: %s", logs)
	}

	// A scanner that doesn't let the area be chosen: the scan comes, and says so.
	local.sizeIgnored = true
	resp := e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(lideID), "size": "A5"})
	checkPDF(t, resp, 1)
	if got := resp.Header.Get("X-Scan-Warning"); got != msgGlassAreaUsed {
		t.Errorf("X-Scan-Warning = %q", got)
	}
	ans := checkImages(t, e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(lideID), "size": "A5", "output": "images"}), 1)
	if ans.Warning != msgGlassAreaUsed {
		t.Errorf("warning = %q", ans.Warning)
	}
	ans = checkImages(t, e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(adsID), "source": "feeder", "size": "A5", "output": "images"}), 1)
	if ans.Warning != msgFeederSize {
		t.Errorf("feeder warning = %q", ans.Warning)
	}
	// No size asked: nothing to say, as before.
	resp = e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(lideID)})
	checkPDF(t, resp, 1)
	if got := resp.Header.Get("X-Scan-Warning"); got != "" {
		t.Errorf("X-Scan-Warning without a size = %q", got)
	}
	if c := local.lastCall(t); !c.Settings.Size.IsZero() {
		t.Errorf("size = %+v", c.Settings.Size)
	}
}

func TestScannerSizes(t *testing.T) {
	f := &escltest.Scanner{Capabilities: escltest.PlatenPDFCapabilities} // glass 279 mm long
	_, sc := discoveredEnv(t, f, envOptions{})
	if !slices.Equal(sc.Sizes, []string{"A5", "Letter"}) {
		t.Errorf("sizes = %v", sc.Sizes)
	}
	local := newFakeLocal()
	local.caps[lideID] = &wia.Caps{Sources: []string{"platen"}, BedWidth: 5826, BedHeight: 8267} // an A5 glass
	e := newEnv(t, envOptions{local: local})
	for _, s := range e.scanners() {
		want := []string{"A4", "A5", "Letter"}
		if s.Name == "Canon LiDE 300" {
			want = []string{"A5"}
		}
		if !slices.Equal(s.Sizes, want) {
			t.Errorf("%s: sizes = %v, want %v", s.Name, s.Sizes, want)
		}
	}
}

func scanState(t *testing.T, e *env, origin string) ScanState {
	t.Helper()
	resp := e.do("GET", "/v1/scan/state", origin, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("GET /v1/scan/state = %d", resp.StatusCode)
	}
	var st ScanState
	if err := json.Unmarshal(readAll(t, resp), &st); err != nil {
		t.Fatal(err)
	}
	return st
}

// waitState asks until the scan of origin is at stage (or the time is up).
func waitState(t *testing.T, e *env, origin string, stages ...string) ScanState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		st := scanState(t, e, origin)
		if slices.Contains(stages, st.State) || time.Now().After(deadline) {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestScanState(t *testing.T) {
	f := &escltest.Scanner{FeederPages: 2, PageDelay: 400 * time.Millisecond}
	e, sc := discoveredEnv(t, f, envOptions{})
	if st := scanState(t, e, primeOrigin); st != (ScanState{State: "idle"}) {
		t.Errorf("before = %+v", st)
	}
	before := time.Now().Add(-time.Second)
	done := make(chan *http.Response, 1)
	go func() {
		done <- e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": sc.ID, "source": "feeder", "size": "A5", "output": "images"})
	}()
	st := waitState(t, e, primeOrigin, "scanning")
	started, err := time.Parse(time.RFC3339, st.StartedAt)
	if st.State != "scanning" || st.Page < 1 || st.Page > 3 || st.ScannerID != sc.ID || err != nil || started.Before(before.Truncate(time.Second)) || started.After(time.Now()) {
		t.Errorf("while scanning = %+v (%v)", st, err)
	}
	// Another web app, and a request without an Origin, see no scan.
	if st := scanState(t, e, appOrigin); st != (ScanState{State: "idle"}) {
		t.Errorf("another origin = %+v", st)
	}
	if st := scanState(t, e, ""); st != (ScanState{State: "idle"}) {
		t.Errorf("no origin = %+v", st)
	}
	// The feeder moves on to the second page.
	deadline := time.Now().Add(5 * time.Second)
	for st.State != "idle" && st.Page < 2 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
		st = scanState(t, e, primeOrigin)
	}
	if st.Page < 2 || st.State == "idle" {
		t.Errorf("the second page = %+v", st)
	}
	checkImages(t, <-done, 2)
	if st := scanState(t, e, primeOrigin); st != (ScanState{State: "idle"}) {
		t.Errorf("after = %+v", st)
	}
	// A refused scan leaves nothing behind.
	e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": "000000000000"})
	if st := scanState(t, e, primeOrigin); st.State != "idle" {
		t.Errorf("after a refusal = %+v", st)
	}
	if resp := e.do("POST", "/v1/scan/state", primeOrigin, map[string]any{}); resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST /v1/scan/state = %d", resp.StatusCode)
	}
}

func TestLocalScanState(t *testing.T) {
	local := newFakeLocal()
	local.hold, local.started = make(chan struct{}), make(chan struct{})
	e := newEnv(t, envOptions{local: local})
	done := make(chan *http.Response, 1)
	go func() {
		done <- e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(lideID), "size": "A5"})
	}()
	<-local.started
	if st := scanState(t, e, primeOrigin); st.State != "scanning" || st.Page != 1 || st.ScannerID != LocalScannerID(lideID) || st.StartedAt == "" {
		t.Errorf("while scanning = %+v", st)
	}
	close(local.hold)
	checkPDF(t, <-done, 1)
	if st := scanState(t, e, primeOrigin); st.State != "idle" {
		t.Errorf("after = %+v", st)
	}
}
