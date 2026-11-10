// Package server is the helper's HTTP API on 127.0.0.1:47815.
package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"image/png"
	"log"
	"net"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"trendlix.com/scan-helper/internal/config"
	"trendlix.com/scan-helper/internal/escl"
	"trendlix.com/scan-helper/internal/paper"
	"trendlix.com/scan-helper/internal/pdf"
	"trendlix.com/scan-helper/internal/progress"
	"trendlix.com/scan-helper/internal/wia"
)

const (
	// AppID is what GET /v1/status answers as "app".
	AppID = "trendlix-scan-helper"
	// DefaultPort is the helper's fixed port.
	DefaultPort = 47815
	// ListenHost is the only address the helper listens on.
	ListenHost = "127.0.0.1"
	// DefaultScanTimeout stops a scan that makes no progress.
	DefaultScanTimeout = 2 * time.Minute
	// MaxImagePages is how many pages a scan answered as pictures
	// ("output": "images") holds at most.
	MaxImagePages = 10
)

// DefaultOrigins are the web apps allowed to use the helper: the People
// System (people.trendlix.com) and Prime ERP (erp.ppmeg.com), and each one's
// development server on this computer.
var DefaultOrigins = []string{
	"https://people.trendlix.com", "http://localhost:3000",
	"https://erp.ppmeg.com", "http://localhost:5173",
}

// Messages the person scanning sees.
const (
	msgBusy        = "The scanner is busy. Try again in a moment."
	msgFeederEmpty = "The document feeder is empty. Put the pages in the feeder, or scan from the glass."
	msgUnreachable = "The scanner didn't answer. Check that it is switched on and connected to the same network as this computer, then try again."
	msgNoFeeder    = "This scanner has no document feeder. Scan from the glass instead."
	msgNoGlass     = "This scanner has no glass. Put the pages in the document feeder instead."
	msgNoDuplex    = "This scanner can't scan both sides of the page. Turn off two-sided scanning and try again."

	msgLocalBusy        = "The scanner is busy, perhaps with another program on this computer. Close that program or wait a moment, then try again."
	msgLocalWarmingUp   = "The scanner is warming up. Try again in a moment."
	msgLocalUnreachable = "The scanner didn't answer. Check that it is switched on and connected to this computer (its USB cable, or the network for a network scanner), then try again."
	msgNoWIA            = "Windows' scanning (Windows Image Acquisition) isn't working on this computer. Restart the computer and try again."

	msgSizeUnknown   = "The scan size isn't one the helper knows. Choose A4, A5 or Letter, or give its width and height in millimetres."
	msgSizeBad       = "The scan size isn't possible. Give its width and height in millimetres, each from 10 to 1000."
	msgGlassAreaUsed = "This scanner doesn't let the helper choose the area to scan, so the whole glass was scanned."
	msgFeederSize    = "This scanner's document feeder doesn't let the helper choose the page size, so the pages were scanned at the size the scanner chose."
)

// Listen opens the helper's port on 127.0.0.1 only, never on other
// interfaces, so nothing else on the network can reach it.
func Listen(port int) (net.Listener, error) {
	return net.Listen("tcp4", net.JoinHostPort(ListenHost, strconv.Itoa(port)))
}

// ProbeHelper reports whether a TrendLIX Scan Helper answers on port, and
// its version.
func ProbeHelper(port int) (string, bool) {
	c := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil}}
	resp, err := c.Get(fmt.Sprintf("http://%s/v1/status", net.JoinHostPort(ListenHost, strconv.Itoa(port))))
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	var st struct {
		App     string `json:"app"`
		Version string `json:"version"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&st) != nil || st.App != AppID {
		return "", false
	}
	return st.Version, true
}

// Options configure a Server.
type Options struct {
	Version     string
	Registry    *Registry
	Client      *escl.Client
	Config      *config.Store
	Log         *log.Logger
	ScanTimeout time.Duration // default DefaultScanTimeout
	Background  bool          // started at login (for the status page's advice)
	LogPath     string        // shown on the status page
}

// Server serves the helper's API.
type Server struct {
	opts    Options
	origins map[string]bool
	busyMu  sync.Mutex
	busy    map[string]bool
	now     func() time.Time

	watchMu sync.Mutex
	watches map[string][]*scanWatch // the scans under way, by the web app's origin
}

// New makes a Server. The allowed origins are read from the config once.
func New(opts Options) *Server {
	if opts.ScanTimeout <= 0 {
		opts.ScanTimeout = DefaultScanTimeout
	}
	s := &Server{opts: opts, origins: map[string]bool{}, busy: map[string]bool{}, now: time.Now, watches: map[string][]*scanWatch{}}
	for _, o := range DefaultOrigins {
		s.origins[o] = true
	}
	for _, o := range opts.Config.Snapshot().AllowedOrigins {
		s.origins[config.NormalizeOrigin(o)] = true
	}
	return s
}

// Handler returns the HTTP handler with the origin and host checks applied.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/v1/status", s.handleStatus)
	mux.HandleFunc("/v1/scanners", s.handleScanners)
	mux.HandleFunc("/v1/scanners/{id}", s.handleScanner)
	mux.HandleFunc("/v1/scan", s.handleScan)
	mux.HandleFunc("/v1/scan/state", s.handleScanState)
	return s.guard(mux)
}

// guard applies the security rules to every request:
//   - the Host must be this computer (127.0.0.1 or localhost), which stops
//     DNS-rebinding tricks;
//   - a request with an Origin must come from an allowed web app (or the
//     helper's own status page), and gets the CORS headers;
//   - a request without an Origin may only read (GET/HEAD), so other
//     programs and websites can't start scans or change settings.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Vary", "Origin")
		if !loopbackHost(r.Host) {
			writeError(w, http.StatusForbidden, "This address isn't allowed. Open the helper at http://127.0.0.1:47815.")
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !s.originAllowed(origin, r.Host) {
				s.opts.Log.Printf("refused a request from %s (not an allowed website)", origin)
				writeError(w, http.StatusForbidden, "This website isn't allowed to use the TrendLIX Scan Helper.")
				return
			}
			h.Set("Access-Control-Allow-Origin", origin)
			// Chrome's Private Network Access / Local Network Access: a public
			// website may call this local helper.
			h.Set("Access-Control-Allow-Private-Network", "true")
			h.Set("Access-Control-Expose-Headers", "X-Scan-Pages, Content-Disposition, X-Scan-Warning")
		} else if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusForbidden, "This request was refused because it didn't come from the People System or Prime ERP.")
			return
		}
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func loopbackHost(hostport string) bool {
	if hostport == "" {
		return true
	}
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

// originAllowed: the configured web apps, plus pages served by this helper
// itself (a loopback origin on the helper's own port).
func (s *Server) originAllowed(origin, reqHost string) bool {
	o := config.NormalizeOrigin(origin)
	if s.origins[o] {
		return true
	}
	_, port, err := net.SplitHostPort(reqHost)
	if err != nil {
		return false
	}
	for _, h := range []string{"127.0.0.1", "localhost", "[::1]"} {
		if o == "http://"+h+":"+port {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeAPIError(w http.ResponseWriter, err error) {
	var ae *apiError
	if errors.As(err, &ae) {
		writeError(w, ae.status, ae.msg)
		return
	}
	writeError(w, http.StatusInternalServerError, "Something went wrong in the scan helper. Try again.")
}

func methodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, "This action isn't supported here.")
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	return json.NewDecoder(r.Body).Decode(v)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		App     string `json:"app"`
		Version string `json:"version"`
	}{AppID, s.opts.Version})
}

func (s *Server) handleScanners(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		refresh := r.URL.Query().Get("refresh")
		writeJSON(w, http.StatusOK, s.opts.Registry.List(r.Context(), refresh == "1" || refresh == "true"))
	case http.MethodPost:
		var body struct {
			URL string `json:"url"`
		}
		if err := decodeJSON(w, r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "Type the scanner's IP address, for example 192.168.1.50.")
			return
		}
		sc, err := s.opts.Registry.AddManual(r.Context(), body.URL)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, sc)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleScanner(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	if err := s.opts.Registry.RemoveManual(r.PathValue("id")); err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type scanRequest struct {
	ScannerID  string `json:"scannerId"`
	Source     string `json:"source"`
	Duplex     bool   `json:"duplex"`
	ColorMode  string `json:"colorMode"`
	Resolution int    `json:"resolution"`
	// Output is "pdf" (the default): one PDF with every page; or "images":
	// the pages as JPEG pictures in JSON (see writeImages).
	Output string `json:"output"`
	// Size is the area to scan from the scanner's origin corner: "A4" (the
	// default), "A5", "Letter", or { "widthMm", "heightMm" } (package paper).
	Size json.RawMessage `json:"size"`
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var req scanRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "The scan request wasn't understood. Reload the page and try again.")
		return
	}
	source := strings.ToLower(strings.TrimSpace(req.Source))
	if source == "" {
		source = "platen"
	}
	if source != "platen" && source != "feeder" {
		writeError(w, http.StatusBadRequest, "Choose where to scan from: the glass or the document feeder.")
		return
	}
	mode := strings.ToLower(strings.TrimSpace(req.ColorMode))
	if mode == "" {
		mode = "color"
	}
	if mode != "color" && mode != "grayscale" && mode != "bw" {
		writeError(w, http.StatusBadRequest, "Choose colour, grayscale or black and white.")
		return
	}
	dpi := req.Resolution
	if dpi == 0 {
		dpi = 300
	}
	if dpi < 50 || dpi > 2400 {
		writeError(w, http.StatusBadRequest, "That resolution isn't possible. 300 dpi is right for documents.")
		return
	}
	output := strings.ToLower(strings.TrimSpace(req.Output))
	if output == "" {
		output = "pdf"
	}
	if output != "pdf" && output != "images" {
		writeError(w, http.StatusBadRequest, "The scan was asked for in a form the helper can't give. Reload the page and try again.")
		return
	}
	size, err := paper.Parse(req.Size)
	if err != nil {
		if errors.Is(err, paper.ErrBadMm) {
			writeError(w, http.StatusBadRequest, msgSizeBad)
		} else {
			writeError(w, http.StatusBadRequest, msgSizeUnknown)
		}
		return
	}
	if strings.TrimSpace(req.ScannerID) == "" {
		writeError(w, http.StatusBadRequest, "Choose a scanner first.")
		return
	}
	tg, ok := s.opts.Registry.Lookup(req.ScannerID)
	if !ok {
		writeError(w, http.StatusNotFound, "That scanner isn't available any more. Refresh the list of scanners and try again.")
		return
	}
	// Where the scan stands, for GET /v1/scan/state from the same web app.
	origin := config.NormalizeOrigin(r.Header.Get("Origin"))
	sw := s.watch(origin, req.ScannerID)
	defer s.unwatch(origin, sw)
	ctx := progress.With(r.Context(), sw.set)
	if tg.Local {
		s.scanLocal(ctx, w, tg, source, req.Duplex, mode, dpi, output, size)
		return
	}

	cctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	caps, err := s.opts.Registry.Caps(cctx, tg.URL)
	cancel()
	if err != nil {
		s.opts.Log.Printf("scan on %q failed: could not read its capabilities: %v", tg.Name, err)
		if escl.KindOf(err) == escl.KindNotScanner {
			writeError(w, http.StatusBadGateway, "The scanner reported an error: it didn't describe what it can do.")
			return
		}
		writeError(w, http.StatusBadGateway, msgUnreachable)
		return
	}
	in := caps.Input(source)
	if in == nil {
		if source == "feeder" {
			writeError(w, http.StatusBadRequest, msgNoFeeder)
		} else {
			writeError(w, http.StatusBadRequest, msgNoGlass)
		}
		return
	}
	duplex := req.Duplex && source == "feeder"
	if duplex && !caps.Duplex {
		writeError(w, http.StatusBadRequest, msgNoDuplex)
		return
	}
	format, ok := escl.ChooseFormat(in)
	if !ok {
		writeError(w, http.StatusBadGateway, "The scanner reported an error: it can't send scans as JPEG or PDF, which the helper needs.")
		return
	}
	if output == "images" && format == "application/pdf" {
		if !slices.Contains(in.Formats, "image/png") {
			writeError(w, http.StatusBadRequest, "This scanner sends its scans as PDF files only, so it can't give them as pictures. Choose another scanner.")
			return
		}
		format = "image/png"
	}
	width, height := escl.Region(in, size)
	settings := escl.ScanSettings{
		Version:    caps.Version,
		Source:     map[string]string{"platen": escl.SourcePlaten, "feeder": escl.SourceFeeder}[source],
		Duplex:     duplex,
		ColorMode:  escl.ChooseColorMode(in, mode),
		Resolution: escl.ChooseResolution(in, dpi),
		Format:     format,
		Width:      width,
		Height:     height,
	}

	if !s.claim(tg.busyKey()) {
		writeError(w, http.StatusConflict, msgBusy)
		return
	}
	defer s.release(tg.busyKey())

	started := time.Now()
	sides := ""
	if duplex {
		sides = ", both sides"
	}
	s.opts.Log.Printf("scan started on %q (%s): %s%s, %s, %d dpi, %s, %s (%d x %d)", tg.Name, tg.URL, source, sides, settings.ColorMode, settings.Resolution, format,
		size.OrA4(), width, height)
	docs, err := s.opts.Client.Scan(ctx, tg.URL, settings, s.opts.ScanTimeout)
	if err != nil {
		s.writeScanError(w, err, tg)
		return
	}
	progress.Report(ctx, progress.Transferring, len(docs))
	s.writeScan(w, docs, settings.Resolution, output, tg, started, "")
}

// scanLocal scans with a scanner installed in Windows (WIA).
func (s *Server) scanLocal(ctx context.Context, w http.ResponseWriter, tg target, source string, duplex bool, mode string, dpi int, output string, size paper.Size) {
	caps := tg.LocalCaps
	duplex = duplex && source == "feeder"
	settings := wia.Settings{Source: source, Duplex: duplex, ColorMode: mode, Resolution: dpi, Size: size}
	if caps != nil {
		if !slices.Contains(caps.Sources, source) {
			if source == "feeder" {
				writeError(w, http.StatusBadRequest, msgNoFeeder)
			} else {
				writeError(w, http.StatusBadRequest, msgNoGlass)
			}
			return
		}
		if duplex && !caps.Duplex {
			writeError(w, http.StatusBadRequest, msgNoDuplex)
			return
		}
		settings.ColorMode = wia.ChooseColorMode(caps.ColorModes, mode)
		settings.Resolution = wia.Nearest(caps.Resolutions, dpi)
	}
	if output == "images" {
		settings.MaxPages = MaxImagePages
	}
	if !s.claim(tg.busyKey()) {
		writeError(w, http.StatusConflict, msgLocalBusy)
		return
	}
	defer s.release(tg.busyKey())

	started := time.Now()
	sides := ""
	if duplex {
		sides = ", both sides"
	}
	s.opts.Log.Printf("scan started on %q (installed in Windows): %s%s, %s, %d dpi, %s", tg.Name, source, sides, settings.ColorMode, settings.Resolution, size.OrA4())
	res, err := s.opts.Registry.Local.Scan(ctx, tg.DeviceID, settings, caps, s.opts.ScanTimeout)
	if err != nil {
		s.writeLocalError(w, err, tg)
		return
	}
	warning := ""
	if res.SizeIgnored {
		warning = msgGlassAreaUsed
		if source == "feeder" {
			warning = msgFeederSize
		}
	}
	if res.Width > 0 && res.Height > 0 {
		s.opts.Log.Printf("scan area on %q: %d x %d pixels", tg.Name, res.Width, res.Height)
	}
	docs := make([]escl.Document, len(res.Pages))
	for i, p := range res.Pages {
		docs[i] = escl.Document{ContentType: p.ContentType, Data: p.Data}
	}
	progress.Report(ctx, progress.Transferring, len(docs))
	s.writeScan(w, docs, settings.Resolution, output, tg, started, warning)
}

// joinWarnings puts warnings together, leaving out empty ones.
func joinWarnings(ws ...string) string {
	var out []string
	for _, w := range ws {
		if w != "" {
			out = append(out, w)
		}
	}
	return strings.Join(out, " ")
}

// writeScan answers a scan: one PDF, or the pages as pictures. warning is
// what the scan itself has to say (the size asked couldn't be used).
func (s *Server) writeScan(w http.ResponseWriter, docs []escl.Document, dpi int, output string, tg target, started time.Time, warning string) {
	if output == "images" {
		s.writeImages(w, docs, dpi, tg, started, warning)
		return
	}
	data, pages, pdfWarning, err := assemble(docs, dpi, "TrendLIX Scan Helper "+s.opts.Version, s.now())
	warning = joinWarnings(warning, pdfWarning)
	if err != nil {
		s.opts.Log.Printf("scan on %q failed: %v", tg.Name, err)
		writeError(w, http.StatusBadGateway, "The scanner reported an error: "+err.Error()+".")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/pdf")
	h.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="scan-%s.pdf"`, s.now().Format("20060102-150405")))
	h.Set("Content-Length", strconv.Itoa(len(data)))
	h.Set("X-Scan-Pages", strconv.Itoa(pages))
	h.Set("Cache-Control", "no-store")
	if warning != "" {
		h.Set("X-Scan-Warning", warning)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	s.opts.Log.Printf("scan finished on %q: %d page(s), %d KB, %.1fs", tg.Name, pages, len(data)/1024, time.Since(started).Seconds())
	if warning != "" {
		s.opts.Log.Printf("scan warning: %s", warning)
	}
}

// ImagePage is one page of a scan answered as pictures.
type ImagePage struct {
	ContentType string `json:"contentType"` // always image/jpeg
	Width       int    `json:"width"`       // pixels
	Height      int    `json:"height"`
	DPI         int    `json:"dpi"`
	Data        string `json:"data"` // the JPEG, base64
}

// ImagesAnswer is the answer of a scan with "output": "images".
type ImagesAnswer struct {
	Pages   []ImagePage `json:"pages"`
	Warning string      `json:"warning,omitempty"`
}

// writeImages answers the pages as JPEG pictures in JSON, for a web page
// that works on the picture itself (an ID card, a photo).
func (s *Server) writeImages(w http.ResponseWriter, docs []escl.Document, dpi int, tg target, started time.Time, warning string) {
	ans, err := images(docs, dpi)
	if err != nil {
		s.opts.Log.Printf("scan on %q failed: %v", tg.Name, err)
		writeError(w, http.StatusBadGateway, "The scanner reported an error: "+err.Error()+".")
		return
	}
	ans.Warning = joinWarnings(warning, ans.Warning)
	data, _ := json.Marshal(ans)
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Content-Length", strconv.Itoa(len(data)))
	h.Set("X-Scan-Pages", strconv.Itoa(len(ans.Pages)))
	h.Set("Cache-Control", "no-store")
	if ans.Warning != "" {
		h.Set("X-Scan-Warning", ans.Warning)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	s.opts.Log.Printf("scan finished on %q: %d page(s) as pictures, %d KB, %.1fs", tg.Name, len(ans.Pages), len(data)/1024, time.Since(started).Seconds())
	if ans.Warning != "" {
		s.opts.Log.Printf("scan warning: %s", ans.Warning)
	}
}

// images turns what the scanner sent into JPEG pages: JPEGs as they came,
// PNGs made JPEGs. A PDF can't be given as pictures.
func images(docs []escl.Document, dpi int) (ImagesAnswer, error) {
	ans := ImagesAnswer{Pages: []ImagePage{}}
	if len(docs) == 0 {
		return ans, errors.New("it sent no pages")
	}
	if len(docs) > MaxImagePages {
		ans.Warning = fmt.Sprintf("The scanner sent %d pages; only the first %d are included.", len(docs), MaxImagePages)
		docs = docs[:MaxImagePages]
	}
	for i, d := range docs {
		b := d.Data
		if pdf.IsPDF(b) {
			return ans, errors.New("it sent a PDF file instead of pictures")
		}
		if pdf.IsPNG(b) {
			var err error
			if b, err = pngToJPEG(b); err != nil {
				return ans, fmt.Errorf("page %d couldn't be read", i+1)
			}
		}
		if !pdf.IsJPEG(b) {
			return ans, fmt.Errorf("page %d came in a format the helper can't read (%s)", i+1, d.ContentType)
		}
		img, err := pdf.ParseJPEG(b)
		if err != nil {
			return ans, fmt.Errorf("page %d couldn't be read: %v", i+1, err)
		}
		pageDPI := dpi
		if img.DPIX > 0 {
			pageDPI = int(img.DPIX + 0.5)
		}
		ans.Pages = append(ans.Pages, ImagePage{
			ContentType: "image/jpeg", Width: img.Width, Height: img.Height, DPI: pageDPI,
			Data: base64.StdEncoding.EncodeToString(b),
		})
	}
	return ans, nil
}

// scanWatch is where a scan under way stands, for GET /v1/scan/state.
type scanWatch struct {
	scannerID string
	started   time.Time

	mu    sync.Mutex
	stage string
	page  int
}

func (sw *scanWatch) set(stage string, page int) {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	sw.stage, sw.page = stage, page
}

// ScanState is the answer of GET /v1/scan/state.
type ScanState struct {
	// State is "connecting", "scanning", "transferring" or "idle".
	State string `json:"state"`
	// Page is the page being scanned or on its way (1 for the first; the
	// number of pages once they are all on their way to the web page); 0
	// while connecting, or idle.
	Page      int    `json:"page"`
	ScannerID string `json:"scannerId,omitempty"`
	StartedAt string `json:"startedAt,omitempty"` // RFC 3339, UTC
}

// watch starts following a scan asked by origin.
func (s *Server) watch(origin, scannerID string) *scanWatch {
	sw := &scanWatch{scannerID: scannerID, started: s.now(), stage: progress.Connecting}
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	s.watches[origin] = append(s.watches[origin], sw)
	return sw
}

// unwatch stops following a scan, which has ended.
func (s *Server) unwatch(origin string, sw *scanWatch) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	list := slices.DeleteFunc(s.watches[origin], func(x *scanWatch) bool { return x == sw })
	if len(list) == 0 {
		delete(s.watches, origin)
		return
	}
	s.watches[origin] = list
}

// handleScanState answers where the scan the same web app started last, and
// is still under way, stands; "idle" when there is none. A request without
// an Origin (another program, the address bar) is told "idle": it can't see
// a web app's scans.
func (s *Server) handleScanState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}
	st := ScanState{State: progress.Idle}
	if origin := r.Header.Get("Origin"); origin != "" {
		s.watchMu.Lock()
		list := s.watches[config.NormalizeOrigin(origin)]
		var sw *scanWatch
		if len(list) > 0 {
			sw = list[len(list)-1]
		}
		s.watchMu.Unlock()
		if sw != nil {
			sw.mu.Lock()
			st = ScanState{State: sw.stage, Page: sw.page, ScannerID: sw.scannerID, StartedAt: sw.started.UTC().Format(time.RFC3339)}
			sw.mu.Unlock()
		}
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) claim(u string) bool {
	s.busyMu.Lock()
	defer s.busyMu.Unlock()
	if s.busy[u] {
		return false
	}
	s.busy[u] = true
	return true
}

func (s *Server) release(u string) {
	s.busyMu.Lock()
	defer s.busyMu.Unlock()
	delete(s.busy, u)
}

func (s *Server) writeScanError(w http.ResponseWriter, err error, tg target) {
	var se *escl.Error
	if !errors.As(err, &se) {
		se = &escl.Error{Kind: escl.KindDevice, Detail: err.Error()}
	}
	if se.Kind == escl.KindCanceled {
		s.opts.Log.Printf("scan on %q cancelled: the web page stopped waiting", tg.Name)
		return
	}
	s.opts.Log.Printf("scan on %q failed: %v", tg.Name, err)
	switch se.Kind {
	case escl.KindBusy:
		writeError(w, http.StatusConflict, msgBusy)
	case escl.KindFeederEmpty:
		writeError(w, http.StatusUnprocessableEntity, msgFeederEmpty)
	case escl.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, s.timeoutMessage())
	case escl.KindUnreachable:
		writeError(w, http.StatusBadGateway, msgUnreachable)
	default:
		detail := se.Detail
		if detail == "" {
			detail = "something went wrong"
		}
		writeError(w, http.StatusBadGateway, "The scanner reported an error: "+detail+".")
	}
}

func (s *Server) timeoutMessage() string {
	return fmt.Sprintf("The scan took more than %s, so it was stopped. Check the scanner for a paper jam or a message on its screen, and try again.",
		humanDuration(s.opts.ScanTimeout))
}

// writeLocalError answers a failed scan on a scanner installed in Windows.
func (s *Server) writeLocalError(w http.ResponseWriter, err error, tg target) {
	var we *wia.Error
	if !errors.As(err, &we) {
		we = &wia.Error{Kind: wia.KindDevice, Detail: err.Error()}
	}
	if we.Kind == wia.KindCanceled {
		s.opts.Log.Printf("scan on %q cancelled: the web page stopped waiting", tg.Name)
		return
	}
	s.opts.Log.Printf("scan on %q failed: %v", tg.Name, err)
	switch we.Kind {
	case wia.KindBusy:
		writeError(w, http.StatusConflict, msgLocalBusy)
	case wia.KindWarmingUp:
		writeError(w, http.StatusConflict, msgLocalWarmingUp)
	case wia.KindFeederEmpty:
		writeError(w, http.StatusUnprocessableEntity, msgFeederEmpty)
	case wia.KindNoFeeder:
		writeError(w, http.StatusBadRequest, msgNoFeeder)
	case wia.KindNoFlatbed:
		writeError(w, http.StatusBadRequest, msgNoGlass)
	case wia.KindTimeout:
		writeError(w, http.StatusGatewayTimeout, s.timeoutMessage())
	case wia.KindOffline, wia.KindNotFound:
		writeError(w, http.StatusBadGateway, msgLocalUnreachable)
	case wia.KindNoWIA:
		writeError(w, http.StatusBadGateway, msgNoWIA)
	default:
		detail := we.Detail
		if detail == "" {
			detail = "something went wrong"
		}
		writeError(w, http.StatusBadGateway, "The scanner reported an error: "+detail+".")
	}
}

func humanDuration(d time.Duration) string {
	switch {
	case d >= time.Minute && d%time.Minute == 0:
		if d == time.Minute {
			return "1 minute"
		}
		return fmt.Sprintf("%d minutes", int(d/time.Minute))
	case d >= time.Second:
		return fmt.Sprintf("%.0f seconds", d.Seconds())
	}
	return fmt.Sprintf("%.1f seconds", d.Seconds())
}

// assemble turns what the scanner sent into one PDF. JPEG (or PNG) pages are
// put into a new PDF; a PDF from the scanner is passed through.
func assemble(docs []escl.Document, dpi int, producer string, now time.Time) (data []byte, pages int, warning string, err error) {
	if len(docs) == 0 {
		return nil, 0, "", errors.New("it sent no pages")
	}
	if pdf.IsPDF(docs[0].Data) {
		data = docs[0].Data
		pages = max(pdf.CountPages(data), 1)
		if len(docs) > 1 {
			warning = fmt.Sprintf("The scanner sent %d separate PDF files; only the first one is included.", len(docs))
		}
		return data, pages, warning, nil
	}
	images := make([]pdf.Image, 0, len(docs))
	for i, d := range docs {
		b := d.Data
		if pdf.IsPNG(b) {
			if b, err = pngToJPEG(b); err != nil {
				return nil, 0, "", fmt.Errorf("page %d couldn't be read", i+1)
			}
		}
		if !pdf.IsJPEG(b) {
			return nil, 0, "", fmt.Errorf("page %d came in a format the helper can't read (%s)", i+1, d.ContentType)
		}
		img, err := pdf.ParseJPEG(b)
		if err != nil {
			return nil, 0, "", fmt.Errorf("page %d couldn't be read: %v", i+1, err)
		}
		images = append(images, img)
	}
	var buf bytes.Buffer
	if err := pdf.Write(&buf, images, pdf.Options{Producer: producer, Created: now, DefaultDPI: float64(dpi)}); err != nil {
		return nil, 0, "", err
	}
	return buf.Bytes(), len(images), "", nil
}

func pngToJPEG(b []byte) ([]byte, error) {
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 92}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
