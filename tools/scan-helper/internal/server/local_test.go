package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"trendlix.com/scan-helper/internal/discovery"
	"trendlix.com/scan-helper/internal/escl"
	"trendlix.com/scan-helper/internal/escltest"
	"trendlix.com/scan-helper/internal/pdf"
	"trendlix.com/scan-helper/internal/progress"
	"trendlix.com/scan-helper/internal/wia"
)

const primeOrigin = "https://erp.ppmeg.com"

// Two scanners installed in Windows: a flatbed on USB, and a sheet-fed one
// that scans both sides.
const (
	lideID = `{6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\0000`
	adsID  = `{6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\0001`
	dsID   = `{6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\0002`
)

var (
	lideCaps = &wia.Caps{Sources: []string{"platen"}, ColorModes: []string{"color", "grayscale"}, Resolutions: []int{75, 150, 300, 600}, BedWidth: 8500, BedHeight: 11690}
	adsCaps  = &wia.Caps{Sources: []string{"feeder"}, Duplex: true, ColorModes: []string{"color", "grayscale", "bw"}, Resolutions: []int{150, 200, 300, 600}, FeedWidth: 8500, FeedHeight: 14000}
)

type scanCall struct {
	ID       string
	Settings wia.Settings
	Caps     *wia.Caps
}

// fakeLocal stands in for WIA: the devices it lists, what they can do, and
// what a scan gives.
type fakeLocal struct {
	mu        sync.Mutex
	off       bool // not Windows
	devs      []wia.Device
	caps      map[string]*wia.Caps
	capsErr   map[string]error
	listErr   error
	knownSeen [][]string
	calls     []scanCall
	pages     int
	scanErr   error
	// sizeIgnored: the scanner doesn't let the area be chosen (a size asked
	// comes back ignored).
	sizeIgnored bool
	hold        chan struct{} // a scan waits for it
	started     chan struct{} // closed when a scan starts
}

func (f *fakeLocal) Available() bool { return !f.off }

func (f *fakeLocal) List(ctx context.Context, known []string) ([]wia.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.knownSeen = append(f.knownSeen, slices.Clone(known))
	var out []wia.Device
	for _, d := range f.devs {
		if !slices.Contains(known, d.ID) {
			d.CapsAsked = true
			d.Caps, d.CapsErr = f.caps[d.ID], f.capsErr[d.ID]
		}
		out = append(out, d)
	}
	return out, f.listErr
}

func (f *fakeLocal) Scan(ctx context.Context, id string, s wia.Settings, caps *wia.Caps, idle time.Duration) (wia.Result, error) {
	f.mu.Lock()
	f.calls = append(f.calls, scanCall{id, s, caps})
	hold, started, n, err, ignored := f.hold, f.started, f.pages, f.scanErr, f.sizeIgnored
	f.mu.Unlock()
	progress.Report(ctx, progress.Connecting, 0)
	progress.Report(ctx, progress.Scanning, 1)
	if started != nil {
		close(started)
	}
	if hold != nil {
		select {
		case <-hold:
		case <-ctx.Done():
			return wia.Result{}, &wia.Error{Kind: wia.KindCanceled}
		}
	}
	if err != nil {
		return wia.Result{}, err
	}
	if n == 0 {
		n = 1
	}
	if s.MaxPages > 0 {
		n = min(n, s.MaxPages)
	}
	var pages []wia.Page
	for range n {
		pages = append(pages, wia.Page{ContentType: "image/jpeg", Data: escltest.JPEG(248, 350, color.RGBA{R: 200, G: 60, B: 40, A: 255})})
	}
	return wia.Result{Pages: pages, SizeIgnored: ignored && !s.Size.IsZero()}, nil
}

func (f *fakeLocal) lastCall(t *testing.T) scanCall {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) == 0 {
		t.Fatal("no scan reached the scanner")
	}
	return f.calls[len(f.calls)-1]
}

func newFakeLocal() *fakeLocal {
	return &fakeLocal{
		devs: []wia.Device{
			{ID: lideID, Name: "Canon LiDE 300", Manufacturer: "Canon", Port: `\\.\Usbscan0`},
			{ID: adsID, Name: "Brother ADS-1700W", Manufacturer: "Brother"},
			{ID: dsID, Name: "", Description: "EPSON DS-530", Manufacturer: "EPSON"},
		},
		caps:    map[string]*wia.Caps{lideID: lideCaps, adsID: adsCaps},
		capsErr: map[string]error{dsID: &wia.Error{Kind: wia.KindOffline, Code: 0x80210005}},
	}
}

func byName(list []Scanner, name string) (Scanner, bool) {
	for _, s := range list {
		if s.Name == name {
			return s, true
		}
	}
	return Scanner{}, false
}

func TestLocalScannersBesideNetworkOnes(t *testing.T) {
	f := (&escltest.Scanner{}).Start(false)
	t.Cleanup(f.Close)
	local := newFakeLocal()
	e := newEnv(t, envOptions{services: []discovery.Service{serviceFor(t, f, false)}, local: local})

	list := e.scanners()
	var names []string
	for _, s := range list {
		names = append(names, s.Name)
	}
	if want := []string{"Brother ADS-1700W", "Canon LiDE 300", "EPSON DS-530", "HP LaserJet MFP M428fdw"}; !slices.Equal(names, want) {
		t.Fatalf("names = %v, want %v", names, want)
	}

	lide, _ := byName(list, "Canon LiDE 300")
	got, _ := json.Marshal(lide)
	want := `{"id":"` + LocalScannerID(lideID) + `","name":"Canon LiDE 300","url":"wia://this-computer","secure":false,"sources":["platen"],"duplex":false,` +
		`"colorModes":["color","grayscale"],"resolutions":[75,150,300,600],"formats":["image/jpeg"],"sizes":["A4","A5","Letter"],"manual":false,"kind":"wia"}`
	if string(got) != want {
		t.Errorf("scanner =\n%s\nwant\n%s", got, want)
	}
	ads, _ := byName(list, "Brother ADS-1700W")
	if !slices.Equal(ads.Sources, []string{"feeder"}) || !ads.Duplex || ads.Kind != KindWIA {
		t.Errorf("sheet-fed scanner = %+v", ads)
	}
	// One that didn't say what it can do is shown as a glass scanner at 300 dpi.
	ds, _ := byName(list, "EPSON DS-530")
	if !slices.Equal(ds.Sources, []string{"platen"}) || !slices.Equal(ds.Resolutions, []int{300}) || len(ds.ColorModes) != 3 {
		t.Errorf("scanner without capabilities = %+v", ds)
	}
	hp, _ := byName(list, "HP LaserJet MFP M428fdw")
	if hp.Kind != KindESCL || hp.URL != f.BaseURL() {
		t.Errorf("network scanner = %+v", hp)
	}
	for _, s := range list {
		if s.Kind == KindWIA && s.ID == ScannerID(s.URL) {
			t.Errorf("%s: a scanner installed in Windows has its own id", s.Name)
		}
	}

	// Searching again doesn't read again what the scanners said lately
	// (reading it connects to the scanner), nor ask one that couldn't say for
	// ten minutes.
	e.do("GET", "/v1/scanners?refresh=1", appOrigin, nil)
	local.mu.Lock()
	seen := local.knownSeen
	local.mu.Unlock()
	if len(seen) < 2 || len(seen[0]) != 0 {
		t.Fatalf("known = %v", seen)
	}
	if last := seen[len(seen)-1]; !slices.Equal(last, sorted(lideID, adsID, dsID)) {
		t.Errorf("known on the second listing = %v", last)
	}
	if logs := e.logs.String(); !strings.Contains(logs, `found scanner "Canon LiDE 300" installed in Windows`) || !strings.Contains(logs, `couldn't read what scanner "EPSON DS-530" can do`) {
		t.Errorf("logs: %s", logs)
	}
}

func sorted(s ...string) []string { slices.Sort(s); return s }

func TestLocalScannerUnpluggedLeavesTheList(t *testing.T) {
	local := newFakeLocal()
	e := newEnv(t, envOptions{local: local})
	if n := len(e.scanners()); n != 3 {
		t.Fatalf("scanners = %d", n)
	}
	local.mu.Lock()
	local.devs = local.devs[1:]
	local.mu.Unlock()
	resp := e.do("GET", "/v1/scanners?refresh=1", appOrigin, nil)
	var list []Scanner
	json.Unmarshal(readAll(t, resp), &list)
	if _, ok := byName(list, "Canon LiDE 300"); ok || len(list) != 2 {
		t.Errorf("list = %+v", list)
	}
	if resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": LocalScannerID(lideID)}); resp.StatusCode != 404 {
		t.Errorf("scan on an unplugged scanner = %d, want 404", resp.StatusCode)
	}
}

func TestNoLocalScannersOutsideWindows(t *testing.T) {
	local := newFakeLocal()
	local.off = true
	e := newEnv(t, envOptions{local: local})
	if list := e.scanners(); len(list) != 0 {
		t.Errorf("list = %+v", list)
	}
	if len(local.knownSeen) != 0 {
		t.Error("WIA shouldn't be asked where it isn't")
	}
	// And the real one finds none here (these tests run on macOS and Linux).
	if l := wia.New(nil); l.Available() {
		t.Skip("running on Windows")
	}
	if devs, err := wia.New(nil).List(context.Background(), nil); devs != nil || err != nil {
		t.Errorf("List = %v, %v", devs, err)
	}
}

func TestLocalScanAsPDF(t *testing.T) {
	local := newFakeLocal()
	e := newEnv(t, envOptions{local: local})
	resp := e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(lideID), "source": "platen", "colorMode": "color", "resolution": 250})
	checkPDF(t, resp, 1)
	if resp.Header.Get("Access-Control-Allow-Origin") != primeOrigin {
		t.Error("missing CORS header for Prime ERP")
	}
	c := local.lastCall(t)
	if c.ID != lideID || c.Settings != (wia.Settings{Source: "platen", ColorMode: "color", Resolution: 300}) || c.Caps != lideCaps {
		t.Errorf("scan call = %+v", c)
	}

	// Black and white on a scanner that has none: the closest it has.
	checkPDF(t, e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": LocalScannerID(lideID), "colorMode": "bw", "resolution": 600}), 1)
	if c := local.lastCall(t); c.Settings.ColorMode != "grayscale" || c.Settings.Resolution != 600 {
		t.Errorf("settings = %+v", c.Settings)
	}

	// The feeder, both sides, several pages.
	local.pages = 4
	checkPDF(t, e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": LocalScannerID(adsID), "source": "feeder", "duplex": true, "colorMode": "grayscale"}), 4)
	if c := local.lastCall(t); c.Settings != (wia.Settings{Source: "feeder", Duplex: true, ColorMode: "grayscale", Resolution: 300}) {
		t.Errorf("feeder settings = %+v", c.Settings)
	}
	if logs := e.logs.String(); !strings.Contains(logs, `scan started on "Brother ADS-1700W" (installed in Windows): feeder, both sides, grayscale, 300 dpi`) {
		t.Errorf("logs: %s", logs)
	}

	// A scanner that didn't say what it can do is asked as it is.
	checkPDF(t, e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": LocalScannerID(dsID), "source": "feeder", "duplex": true, "colorMode": "bw", "resolution": 200}), 4)
	if c := local.lastCall(t); c.Caps != nil || c.Settings != (wia.Settings{Source: "feeder", Duplex: true, ColorMode: "bw", Resolution: 200}) {
		t.Errorf("call = %+v", c)
	}
}

func TestLocalScanRequestProblems(t *testing.T) {
	local := newFakeLocal()
	e := newEnv(t, envOptions{local: local})
	cases := []struct {
		body   map[string]any
		status int
		msg    string
	}{
		{map[string]any{"scannerId": LocalScannerID(lideID), "source": "feeder"}, 400, msgNoFeeder},
		{map[string]any{"scannerId": LocalScannerID(adsID), "source": "platen"}, 400, msgNoGlass},
		{map[string]any{"scannerId": LocalScannerID(adsID), "output": "tiff"}, 400, "The scan was asked for in a form the helper can't give. Reload the page and try again."},
	}
	for _, c := range cases {
		resp := e.do("POST", "/v1/scan", appOrigin, c.body)
		if resp.StatusCode != c.status {
			t.Errorf("%v: status = %d, want %d", c.body, resp.StatusCode, c.status)
		}
		if msg := errorOf(t, resp); msg != c.msg {
			t.Errorf("%v: error = %q", c.body, msg)
		}
	}
	if len(local.calls) != 0 {
		t.Errorf("no scan should have started: %+v", local.calls)
	}
}

func TestLocalScanErrors(t *testing.T) {
	cases := []struct {
		err    error
		status int
		msg    string
	}{
		{&wia.Error{Kind: wia.KindBusy, Code: 0x80210006}, 409, msgLocalBusy},
		{&wia.Error{Kind: wia.KindWarmingUp}, 409, msgLocalWarmingUp},
		{&wia.Error{Kind: wia.KindFeederEmpty}, 422, msgFeederEmpty},
		{&wia.Error{Kind: wia.KindNoFeeder}, 400, msgNoFeeder},
		{&wia.Error{Kind: wia.KindNoFlatbed}, 400, msgNoGlass},
		{&wia.Error{Kind: wia.KindTimeout}, 504, "The scan took more than 10 seconds, so it was stopped. Check the scanner for a paper jam or a message on its screen, and try again."},
		{&wia.Error{Kind: wia.KindOffline}, 502, msgLocalUnreachable},
		{&wia.Error{Kind: wia.KindNotFound}, 502, msgLocalUnreachable},
		{&wia.Error{Kind: wia.KindNoWIA}, 502, msgNoWIA},
		{&wia.Error{Kind: wia.KindDevice, Detail: "its cover is open"}, 502, "The scanner reported an error: its cover is open."},
		{&wia.Error{Kind: wia.KindDevice, Detail: "Windows reported error 0x80210001"}, 502, "The scanner reported an error: Windows reported error 0x80210001."},
		{errors.New("boom"), 502, "The scanner reported an error: boom."},
	}
	for _, c := range cases {
		local := newFakeLocal()
		local.scanErr = c.err
		e := newEnv(t, envOptions{local: local})
		resp := e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": LocalScannerID(lideID)})
		if resp.StatusCode != c.status {
			t.Errorf("%v: status = %d, want %d", c.err, resp.StatusCode, c.status)
		}
		if msg := errorOf(t, resp); msg != c.msg {
			t.Errorf("%v: error = %q, want %q", c.err, msg, c.msg)
		}
	}
}

func TestLocalScannerBusyWhileItScans(t *testing.T) {
	local := newFakeLocal()
	local.hold, local.started = make(chan struct{}), make(chan struct{})
	e := newEnv(t, envOptions{local: local})
	done := make(chan *http.Response, 1)
	go func() {
		done <- e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": LocalScannerID(lideID)})
	}()
	<-local.started
	resp := e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(lideID)})
	if resp.StatusCode != http.StatusConflict || errorOf(t, resp) != msgLocalBusy {
		t.Errorf("second scan = %d", resp.StatusCode)
	}
	close(local.hold)
	checkPDF(t, <-done, 1)
}

func TestLocalScanAsImages(t *testing.T) {
	local := newFakeLocal()
	local.pages = 2
	e := newEnv(t, envOptions{local: local})
	resp := e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": LocalScannerID(adsID), "source": "feeder", "duplex": true, "output": "images"})
	ans := checkImages(t, resp, 2)
	if ans.Pages[0].Width != 248 || ans.Pages[0].Height != 350 || ans.Pages[0].DPI != 300 || ans.Pages[0].ContentType != "image/jpeg" {
		t.Errorf("page = %+v", ans.Pages[0])
	}
	if c := local.lastCall(t); c.Settings.MaxPages != MaxImagePages {
		t.Errorf("max pages = %d", c.Settings.MaxPages)
	}
}

func checkImages(t *testing.T, resp *http.Response, pages int) ImagesAnswer {
	t.Helper()
	body := readAll(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("scan = %d %s", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q", ct)
	}
	if got := resp.Header.Get("X-Scan-Pages"); got != strconvItoa(pages) {
		t.Errorf("X-Scan-Pages = %q, want %d", got, pages)
	}
	var ans ImagesAnswer
	if err := json.Unmarshal(body, &ans); err != nil {
		t.Fatal(err)
	}
	if len(ans.Pages) != pages {
		t.Fatalf("pages = %d, want %d", len(ans.Pages), pages)
	}
	for i, p := range ans.Pages {
		b, err := base64.StdEncoding.DecodeString(p.Data)
		if err != nil || !pdf.IsJPEG(b) {
			t.Errorf("page %d isn't a JPEG", i+1)
		}
		if img, err := pdf.ParseJPEG(b); err != nil || img.Width != p.Width || img.Height != p.Height {
			t.Errorf("page %d size = %+v, says %dx%d", i+1, img, p.Width, p.Height)
		}
	}
	return ans
}

func strconvItoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestNetworkScanAsImages(t *testing.T) {
	f := &escltest.Scanner{FeederPages: 3}
	e, sc := discoveredEnv(t, f, envOptions{})
	ans := checkImages(t, e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": sc.ID, "source": "feeder", "output": "images"}), 3)
	if ans.Warning != "" || ans.Pages[0].DPI != 300 {
		t.Errorf("answer = %+v", ans.Pages[0])
	}

	// More pages than a picture answer holds: the first ten, and a warning.
	f2 := &escltest.Scanner{FeederPages: 12}
	e2, sc2 := discoveredEnv(t, f2, envOptions{})
	resp := e2.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": sc2.ID, "source": "feeder", "output": "images"})
	ans = checkImages(t, resp, MaxImagePages)
	if ans.Warning != "The scanner sent 12 pages; only the first 10 are included." || resp.Header.Get("X-Scan-Warning") != ans.Warning {
		t.Errorf("warning = %q", ans.Warning)
	}

	// The PDF answer is unchanged when nothing is asked.
	checkPDF(t, e.do("POST", "/v1/scan", appOrigin, map[string]any{"scannerId": sc.ID, "source": "feeder"}), 3)
}

func TestNetworkScanAsImagesFromPDFOnlyScanner(t *testing.T) {
	f := &escltest.Scanner{Capabilities: escltest.PlatenPDFCapabilities, PageType: "application/pdf"}
	e, sc := discoveredEnv(t, f, envOptions{})
	resp := e.do("POST", "/v1/scan", primeOrigin, map[string]any{"scannerId": sc.ID, "output": "images"})
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if msg := errorOf(t, resp); !strings.Contains(msg, "PDF files only") {
		t.Errorf("error = %q", msg)
	}
	if len(f.Settings()) != 0 {
		t.Error("no scan should start")
	}
}

func TestImagesFromPNGPages(t *testing.T) {
	src, err := jpeg.Decode(bytes.NewReader(escltest.JPEG(100, 140, color.Gray{Y: 90})))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	ans, err := images([]escl.Document{{ContentType: "image/png", Data: buf.Bytes()}}, 200)
	if err != nil || len(ans.Pages) != 1 || ans.Pages[0].Width != 100 || ans.Pages[0].Height != 140 || ans.Pages[0].DPI != 200 {
		t.Errorf("images = %+v, %v", ans, err)
	}
	if _, err := images([]escl.Document{{ContentType: "image/bmp", Data: []byte("BM....")}}, 300); err == nil || !strings.Contains(err.Error(), "can't read (image/bmp)") {
		t.Errorf("BMP page: %v", err)
	}
	if _, err := images(nil, 300); err == nil {
		t.Error("no pages should be an error")
	}
}

func TestLocalScannerCantBeRemoved(t *testing.T) {
	e := newEnv(t, envOptions{local: newFakeLocal()})
	resp := e.do("DELETE", "/v1/scanners/"+LocalScannerID(lideID), primeOrigin, nil)
	if resp.StatusCode != 400 {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
	if msg := errorOf(t, resp); !strings.HasPrefix(msg, "This scanner is installed in Windows on this computer") {
		t.Errorf("error = %q", msg)
	}
}

func TestStatusPageShowsLocalScanners(t *testing.T) {
	local := newFakeLocal()
	e := newEnv(t, envOptions{local: local})
	body := string(readAll(t, e.do("GET", "/", "", nil)))
	for _, want := range []string{"Canon LiDE 300", "glass · installed in Windows on this computer", "document feeder · two-sided · installed in Windows on this computer", "People System and Prime ERP"} {
		if !strings.Contains(body, want) {
			t.Errorf("status page lacks %q", want)
		}
	}
	if strings.Contains(body, LocalURL) {
		t.Error("the status page shouldn't show the made-up address of a scanner installed in Windows")
	}

	// WIA can't be used: the page says so, and the scanners listed before stay.
	local.mu.Lock()
	local.listErr, local.devs = &wia.Error{Kind: wia.KindNoWIA, Detail: "Windows PowerShell didn't run"}, nil
	local.mu.Unlock()
	body = string(readAll(t, e.do("GET", "/?refresh=1", "", nil)))
	if !strings.Contains(body, "Windows&#39; scanning (Windows Image Acquisition) can&#39;t be used on this computer") || !strings.Contains(body, "Canon LiDE 300") {
		t.Errorf("status page after a failed listing:\n%s", body)
	}
	if !strings.Contains(e.logs.String(), "listing the scanners installed in Windows failed") {
		t.Error("the failure should be logged")
	}
}

func TestPrimeERPPreflight(t *testing.T) {
	e := newEnv(t, envOptions{})
	for _, o := range []string{primeOrigin, "http://localhost:5173"} {
		resp := e.do("OPTIONS", "/v1/scan", o, nil,
			"Access-Control-Request-Method", "POST",
			"Access-Control-Request-Headers", "content-type",
			"Access-Control-Request-Private-Network", "true")
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("%s: preflight status = %d", o, resp.StatusCode)
		}
		for k, v := range map[string]string{
			"Access-Control-Allow-Origin":          o,
			"Access-Control-Allow-Methods":         "GET, POST, DELETE, OPTIONS",
			"Access-Control-Allow-Headers":         "Content-Type",
			"Access-Control-Allow-Private-Network": "true",
		} {
			if got := resp.Header.Get(k); got != v {
				t.Errorf("%s: preflight %s = %q, want %q", o, k, got, v)
			}
		}
	}
	if resp := e.do("POST", "/v1/scan", "", map[string]any{}); errorOf(t, resp) != "This request was refused because it didn't come from the People System or Prime ERP." {
		t.Error("the refusal should name both systems")
	}
}
