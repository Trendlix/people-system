// Package server is the helper's HTTP API on 127.0.0.1:47815.
package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"image/png"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"trendlix.com/scan-helper/internal/config"
	"trendlix.com/scan-helper/internal/escl"
	"trendlix.com/scan-helper/internal/pdf"
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
)

// DefaultOrigins are the web apps allowed to use the helper.
var DefaultOrigins = []string{"https://people.trendlix.com", "http://localhost:3000"}

// Messages HR sees.
const (
	msgBusy        = "The scanner is busy. Try again in a moment."
	msgFeederEmpty = "The document feeder is empty. Put the pages in the feeder, or scan from the glass."
	msgUnreachable = "The scanner didn't answer. Check that it is switched on and connected to the same network as this computer, then try again."
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
}

// New makes a Server. The allowed origins are read from the config once.
func New(opts Options) *Server {
	if opts.ScanTimeout <= 0 {
		opts.ScanTimeout = DefaultScanTimeout
	}
	s := &Server{opts: opts, origins: map[string]bool{}, busy: map[string]bool{}, now: time.Now}
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
			writeError(w, http.StatusForbidden, "This request was refused because it didn't come from the People System.")
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
	if strings.TrimSpace(req.ScannerID) == "" {
		writeError(w, http.StatusBadRequest, "Choose a scanner first.")
		return
	}
	tg, ok := s.opts.Registry.Lookup(req.ScannerID)
	if !ok {
		writeError(w, http.StatusNotFound, "That scanner isn't available any more. Refresh the list of scanners and try again.")
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
			writeError(w, http.StatusBadRequest, "This scanner has no document feeder. Scan from the glass instead.")
		} else {
			writeError(w, http.StatusBadRequest, "This scanner has no glass. Put the pages in the document feeder instead.")
		}
		return
	}
	duplex := req.Duplex && source == "feeder"
	if duplex && !caps.Duplex {
		writeError(w, http.StatusBadRequest, "This scanner can't scan both sides of the page. Turn off two-sided scanning and try again.")
		return
	}
	format, ok := escl.ChooseFormat(in)
	if !ok {
		writeError(w, http.StatusBadGateway, "The scanner reported an error: it can't send scans as JPEG or PDF, which the helper needs.")
		return
	}
	width, height := escl.Region(in)
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

	if !s.claim(tg.URL) {
		writeError(w, http.StatusConflict, msgBusy)
		return
	}
	defer s.release(tg.URL)

	started := time.Now()
	sides := ""
	if duplex {
		sides = ", both sides"
	}
	s.opts.Log.Printf("scan started on %q (%s): %s%s, %s, %d dpi, %s", tg.Name, tg.URL, source, sides, settings.ColorMode, settings.Resolution, format)
	docs, err := s.opts.Client.Scan(r.Context(), tg.URL, settings, s.opts.ScanTimeout)
	if err != nil {
		s.writeScanError(w, err, tg)
		return
	}
	data, pages, warning, err := assemble(docs, settings.Resolution, "TrendLIX Scan Helper "+s.opts.Version, s.now())
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
		writeError(w, http.StatusGatewayTimeout, fmt.Sprintf(
			"The scan took more than %s, so it was stopped. Check the scanner for a paper jam or a message on its screen, and try again.",
			humanDuration(s.opts.ScanTimeout)))
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
