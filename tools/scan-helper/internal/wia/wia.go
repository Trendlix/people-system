// Package wia scans with the scanners installed in Windows on this computer:
// USB scanners whose driver is installed, and network scanners added in
// Windows. It goes through Windows Image Acquisition (WIA), part of Windows;
// most scanner drivers, TWAIN ones included, install a WIA driver too.
//
// The helper drives WIA with Windows' own scripting: it runs Windows
// PowerShell (built into Windows) with a short script of its own (list.ps1,
// scan.ps1) that uses WIA's COM automation (WIA.DeviceManager), so nothing is
// installed and no library is added. What the script is asked comes in
// environment variables, and it answers in lines of plain text (see the
// scripts). A scan's pages are written to a folder of the helper's own in the
// user's temporary folder, then read and deleted at once.
//
// Everywhere but Windows there are no such scanners: Available is false and
// List finds none.
package wia

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Limits that keep a misbehaving driver from filling the memory (as for
// network scanners).
const (
	MaxPageSize = 200 << 20
	MaxPages    = 300
)

// A4 in thousandths of an inch (210 x 297 mm): the area scanned, or less
// when the glass or the feeder is smaller.
const (
	A4Width  = 8268
	A4Height = 11693
)

// Device is a scanner installed in Windows.
type Device struct {
	ID           string // WIA device id, e.g. {6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\0001
	Name         string
	Manufacturer string
	Description  string
	Port         string

	// What it can do, when it was read this time; CapsErr says why it
	// couldn't be. CapsAsked is false when the helper said it knew them.
	Caps      *Caps
	CapsErr   error
	CapsAsked bool
}

// DisplayName is the name to show for the device.
func (d Device) DisplayName() string {
	for _, n := range []string{d.Name, d.Description} {
		if n = strings.TrimSpace(n); n != "" {
			return n
		}
	}
	if m := strings.TrimSpace(d.Manufacturer); m != "" {
		return m + " scanner"
	}
	return "Scanner on this computer"
}

// Caps is what a scanner can do, as its driver says.
type Caps struct {
	Sources     []string // "platen" (the glass), "feeder"
	Duplex      bool     // the feeder scans both sides
	ColorModes  []string // "color", "grayscale", "bw"; nil when unknown
	Resolutions []int    // dpi, smallest first; nil when unknown
	// The glass and the feeder in thousandths of an inch; 0 when unknown.
	BedWidth, BedHeight   int
	FeedWidth, FeedHeight int
}

// Settings is one scan.
type Settings struct {
	Source     string // "platen" or "feeder"
	Duplex     bool
	ColorMode  string // "color", "grayscale" or "bw"
	Resolution int
	MaxPages   int // 0 means MaxPages
}

// Page is one scanned page as the driver gave it (made a JPEG when Windows
// could).
type Page struct {
	ContentType string // image/jpeg, image/png or image/bmp
	Data        []byte
}

// Kind says what went wrong.
type Kind int

const (
	KindNoWIA       Kind = iota + 1 // Windows' scanning (WIA) can't be used on this computer
	KindNotFound                    // the scanner isn't installed or connected any more
	KindOffline                     // it doesn't answer: switched off, unplugged, or out of reach
	KindBusy                        // another program is using it
	KindWarmingUp                   // its lamp is warming up
	KindFeederEmpty                 // no paper in the document feeder
	KindNoFeeder                    // it has no document feeder
	KindNoFlatbed                   // it has no glass
	KindTimeout                     // the scan made no progress for too long
	KindCanceled                    // the web page stopped waiting
	KindDevice                      // the scanner or its driver reported a problem (Detail)
)

// Error is a problem with a scanner installed in Windows. Detail is a
// plain-English clause for KindDevice; Code is the WIA or Windows error code
// when there was one.
type Error struct {
	Kind   Kind
	Code   uint32
	Detail string
	Err    error
}

func (e *Error) Error() string {
	s := map[Kind]string{
		KindNoWIA: "Windows Image Acquisition unavailable", KindNotFound: "scanner not found", KindOffline: "scanner offline",
		KindBusy: "scanner busy", KindWarmingUp: "scanner warming up", KindFeederEmpty: "document feeder empty",
		KindNoFeeder: "no document feeder", KindNoFlatbed: "no glass", KindTimeout: "scan timed out", KindCanceled: "scan cancelled",
	}[e.Kind]
	if s == "" {
		s = "scanner error"
	}
	if e.Detail != "" {
		s += ": " + e.Detail
	}
	if e.Code != 0 {
		s += fmt.Sprintf(" (0x%08X)", e.Code)
	}
	if e.Err != nil {
		s += " (" + e.Err.Error() + ")"
	}
	return s
}

func (e *Error) Unwrap() error { return e.Err }

// KindOf returns the Kind of an error of this package, or 0.
func KindOf(err error) Kind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return 0
}

// Backend is what the helper's server needs: the scanners installed on this
// computer, and scanning with one.
type Backend interface {
	// Available reports whether this computer can have such scanners.
	Available() bool
	// List finds the scanners. Those whose ids are in known are listed
	// without reading what they can do again.
	List(ctx context.Context, known []string) ([]Device, error)
	// Scan scans with the scanner id. caps, when known, gives the size of
	// the glass or the feeder. idle limits how long the scan may go without
	// a page; it restarts with each page.
	Scan(ctx context.Context, id string, s Settings, caps *Caps, idle time.Duration) ([]Page, error)
}

// Runner runs a PowerShell script with the environment variables env added,
// calling line for each line the script writes, until it ends or ctx ends.
type Runner func(ctx context.Context, script string, env []string, line func(string)) error

// Local is the Backend of this computer: WIA through PowerShell on Windows,
// nothing elsewhere.
type Local struct {
	Run         Runner        // nil: no such scanners here
	TempDir     string        // where scans are written; default <temp>/trendlix-scan-helper
	ListTimeout time.Duration // default 30 seconds
	Logf        func(format string, args ...any)
}

// New returns the Backend of this computer.
func New(logf func(format string, args ...any)) *Local {
	return &Local{Run: platformRunner(), Logf: logf}
}

// Available reports whether this computer can have scanners installed in
// Windows (it is Windows).
func (l *Local) Available() bool { return l != nil && l.Run != nil }

func (l *Local) logf(format string, args ...any) {
	if l.Logf != nil {
		l.Logf(format, args...)
	}
}

// TempBase is the helper's own folder in the user's temporary folder.
func TempBase() string { return filepath.Join(os.TempDir(), "trendlix-scan-helper") }

func (l *Local) tempDir() (string, error) {
	dir := l.TempDir
	if dir == "" {
		dir = TempBase()
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// CleanTemp removes scan folders left behind (for example by a computer
// switched off in the middle of a scan), so no scanned page stays on disk.
func CleanTemp(dir string) {
	if dir == "" {
		dir = TempBase()
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "scan-") {
			_ = os.RemoveAll(filepath.Join(dir, e.Name()))
		}
	}
}

// ---------- the scripts ----------

//go:embed common.ps1
var commonScript string

//go:embed list.ps1
var listScript string

//go:embed scan.ps1
var scanScript string

// Script returns a script as it is run: the shared part and the script,
// without comments, blank lines or indentation.
func Script(name string) string {
	body := map[string]string{"list": listScript, "scan": scanScript}[name]
	var b strings.Builder
	for _, part := range []string{commonScript, body} {
		for _, line := range strings.Split(strings.ReplaceAll(part, "\r\n", "\n"), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			b.WriteString(line)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

// ---------- listing ----------

// List finds the scanners installed in Windows, reading what they can do but
// for those in known. Devices found before an error are given with it.
func (l *Local) List(ctx context.Context, known []string) ([]Device, error) {
	if !l.Available() {
		return nil, nil
	}
	timeout := l.ListTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	p := &listParser{}
	runErr := l.Run(ctx, Script("list"), []string{"TLX_WIA_KNOWN=" + strings.Join(known, "|")}, p.line)
	for _, w := range p.warnings {
		l.logf("scanners installed in Windows: %s", w)
	}
	devs := p.result()
	switch {
	case p.err != nil:
		return devs, p.err
	case runErr != nil && !p.ended:
		if ctx.Err() != nil {
			return devs, &Error{Kind: KindDevice, Detail: "listing the scanners installed in Windows took too long", Err: runErr}
		}
		return devs, &Error{Kind: KindNoWIA, Detail: "Windows PowerShell didn't run", Err: runErr}
	case !p.ended:
		return devs, &Error{Kind: KindDevice, Detail: "the list of scanners installed in Windows ended early"}
	}
	return devs, nil
}

type listParser struct {
	devs     []*Device
	byID     map[string]*Device
	err      *Error
	ended    bool
	warnings []string
}

func (p *listParser) line(s string) {
	f := strings.Fields(s)
	if len(f) == 0 {
		return
	}
	switch f[0] {
	case "DEV":
		if len(f) < 2 {
			return
		}
		d := &Device{ID: unb64(f[1])}
		if d.ID == "" {
			return
		}
		for i, dst := range []*string{&d.Name, &d.Manufacturer, &d.Description, &d.Port} {
			if len(f) > i+2 {
				*dst = strings.TrimSpace(unb64(f[i+2]))
			}
		}
		if p.byID == nil {
			p.byID = map[string]*Device{}
		}
		if p.byID[d.ID] == nil {
			p.devs = append(p.devs, d)
			p.byID[d.ID] = d
		}
	case "CAPS":
		if len(f) < 2 {
			return
		}
		if d := p.byID[unb64(f[1])]; d != nil {
			d.Caps, d.CapsErr, d.CapsAsked = ParseCaps(f[2:]), nil, true
		}
	case "CAPSERR":
		if len(f) < 2 {
			return
		}
		if d := p.byID[unb64(f[1])]; d != nil {
			codes, msg := "", ""
			if len(f) > 2 {
				codes = f[2]
			}
			if len(f) > 3 {
				msg = unb64(f[3])
			}
			d.Caps, d.CapsErr, d.CapsAsked = nil, FromCodes(codes, msg), true
		}
	case "ERR":
		p.err = parseErr(f[1:])
	case "WARN":
		if len(f) > 1 {
			p.warnings = append(p.warnings, unb64(f[1]))
		}
	case "END":
		p.ended = true
	}
}

func (p *listParser) result() []Device {
	out := make([]Device, 0, len(p.devs))
	for _, d := range p.devs {
		out = append(out, *d)
	}
	return out
}

// unb64 reads text as the scripts write it: base64, or - when empty.
func unb64(s string) string {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return ""
	}
	return string(b)
}

// standardResolutions are offered from a driver's range of resolutions.
var standardResolutions = []int{75, 100, 150, 200, 240, 300, 400, 600, 1200}

// ParseCaps reads the key=value fields of a CAPS line.
func ParseCaps(fields []string) *Caps {
	c := &Caps{}
	for _, kv := range fields {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		switch k {
		case "src":
			for _, s := range strings.Split(v, ",") {
				if (s == "platen" || s == "feeder") && !slices.Contains(c.Sources, s) {
					c.Sources = append(c.Sources, s)
				}
			}
		case "dup":
			c.Duplex = v == "1"
		case "res":
			c.Resolutions = resolutions(v)
		case "types":
			c.ColorModes = colorModes(v)
		case "bed":
			c.BedWidth, c.BedHeight = size(v)
		case "feed":
			c.FeedWidth, c.FeedHeight = size(v)
		}
	}
	if len(c.Sources) == 0 {
		c.Sources = []string{"platen"}
	}
	if !slices.Contains(c.Sources, "feeder") {
		c.Duplex = false
	}
	return c
}

// values reads range:min:max:step, list:a,b,c or value:v.
func values(v string) (isRange bool, nums []int) {
	kind, rest, _ := strings.Cut(v, ":")
	sep := ","
	if kind == "range" {
		sep = ":"
	}
	for _, s := range strings.Split(rest, sep) {
		if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
			nums = append(nums, n)
		}
	}
	switch kind {
	case "range":
		if len(nums) != 3 {
			return false, nil
		}
		return true, nums
	case "list", "value":
		return false, nums
	}
	return false, nil
}

func resolutions(v string) []int {
	isRange, nums := values(v)
	var out []int
	if isRange {
		lo, hi, step := nums[0], nums[1], nums[2]
		for _, r := range standardResolutions {
			if r >= lo && r <= hi && (step <= 1 || (r-lo)%step == 0) {
				out = append(out, r)
			}
		}
		if len(out) == 0 {
			out = []int{lo, hi}
		}
	} else {
		out = nums
	}
	var clean []int
	for _, r := range out {
		if r >= 50 && r <= 2400 && !slices.Contains(clean, r) {
			clean = append(clean, r)
		}
	}
	sort.Ints(clean)
	return clean
}

// colorModes reads WIA data types: 3 colour, 2 greyscale, 0 or 1 black and
// white.
func colorModes(v string) []string {
	isRange, nums := values(v)
	if isRange {
		return nil
	}
	var out []string
	for _, m := range []string{"color", "grayscale", "bw"} {
		for _, n := range nums {
			if (m == "color" && n == 3) || (m == "grayscale" && n == 2) || (m == "bw" && (n == 0 || n == 1)) {
				out = append(out, m)
				break
			}
		}
	}
	return out
}

func size(v string) (int, int) {
	a, b, ok := strings.Cut(v, "x")
	if !ok {
		return 0, 0
	}
	w, err1 := strconv.Atoi(a)
	h, err2 := strconv.Atoi(b)
	if err1 != nil || err2 != nil || w < 0 || h < 0 {
		return 0, 0
	}
	return w, h
}

// ---------- errors ----------

// Known WIA error codes (wia.h).
const (
	codePaperJam      = 0x80210002
	codePaperEmpty    = 0x80210003
	codePaperProblem  = 0x80210004
	codeOffline       = 0x80210005
	codeBusy          = 0x80210006
	codeWarmingUp     = 0x80210007
	codeIntervention  = 0x80210008
	codeItemDeleted   = 0x80210009
	codeCommunication = 0x8021000A
	codeLocked        = 0x8021000D
	codeNoDevice      = 0x80210015
	codeCoverOpen     = 0x80210016
	codeLampOff       = 0x80210017
	codeMultiFeed     = 0x80210020
)

// Codes that only say an error came from somewhere else: the code inside
// them says more.
var wrapperCodes = map[uint32]bool{
	0x80131500: true, // .NET exception
	0x80131501: true, // .NET SystemException
	0x80131509: true, // .NET InvalidOperationException
	0x80020009: true, // DISP_E_EXCEPTION
	0x80004005: true, // E_FAIL
	0x80070057: true, // E_INVALIDARG
}

var hexCode = regexp.MustCompile(`(?i)\b(?:0x)?(8[0-9a-f]{7})\b`)

// PickCode chooses the code that says most from the comma-separated codes
// of an error and the errors inside it, and its message: a WIA code first
// (0x8021...), then one that isn't a mere wrapper, then any.
func PickCode(codes, message string) uint32 {
	var all []uint32
	for _, c := range strings.Split(codes, ",") {
		if n, err := strconv.ParseUint(strings.TrimSpace(c), 16, 32); err == nil && n != 0 {
			all = append(all, uint32(n))
		}
	}
	for _, m := range hexCode.FindAllStringSubmatch(message, -1) {
		if n, err := strconv.ParseUint(m[1], 16, 32); err == nil {
			all = append(all, uint32(n))
		}
	}
	for _, c := range all {
		if c&0xFFFF0000 == 0x80210000 {
			return c
		}
	}
	for _, c := range all {
		if !wrapperCodes[c] {
			return c
		}
	}
	if len(all) > 0 {
		return all[len(all)-1]
	}
	return 0
}

// FromCodes turns what a script said of an error into an Error.
func FromCodes(codes, message string) *Error {
	code := PickCode(codes, message)
	e := &Error{Code: code}
	if strings.Contains(strings.ToLower(message), "language mode") {
		// A computer locked down by its administrator (AppLocker, Device
		// Guard) runs PowerShell in constrained language mode, which doesn't
		// let a script use WIA.
		e.Kind, e.Detail = KindDevice, "this computer's security settings don't let the helper use Windows' scanning (PowerShell's constrained language mode)"
		return e
	}
	switch code {
	case codePaperEmpty:
		e.Kind = KindFeederEmpty
	case codeBusy, codeLocked:
		e.Kind = KindBusy
	case codeWarmingUp:
		e.Kind = KindWarmingUp
	case codeOffline, codeCommunication, codeNoDevice:
		e.Kind = KindOffline
	case codeItemDeleted:
		e.Kind = KindNotFound
	case codePaperJam:
		e.Kind, e.Detail = KindDevice, "paper is stuck in it"
	case codeMultiFeed:
		e.Kind, e.Detail = KindDevice, "it pulled in more than one page at a time"
	case codePaperProblem:
		e.Kind, e.Detail = KindDevice, "there is a problem with the paper"
	case codeCoverOpen:
		e.Kind, e.Detail = KindDevice, "its cover is open"
	case codeLampOff:
		e.Kind, e.Detail = KindDevice, "its lamp is off"
	case codeIntervention:
		e.Kind, e.Detail = KindDevice, "it needs attention (look at the scanner)"
	case 0x80040154, // the WIA scripting library isn't registered
		0x80070422, // the WIA service is disabled
		0x80070426: // the WIA service isn't started
		e.Kind = KindNoWIA
	default:
		e.Kind = KindDevice
		if code != 0 {
			e.Detail = fmt.Sprintf("Windows reported error 0x%08X", code)
		} else {
			e.Detail = "something went wrong in Windows' scanning"
		}
	}
	return e
}

func parseErr(f []string) *Error {
	if len(f) == 0 {
		return &Error{Kind: KindDevice, Detail: "something went wrong in Windows' scanning"}
	}
	switch f[0] {
	case "NOTFOUND":
		return &Error{Kind: KindNotFound}
	case "NOFEEDER":
		return &Error{Kind: KindNoFeeder}
	case "NOFLATBED":
		return &Error{Kind: KindNoFlatbed}
	}
	msg := ""
	if len(f) > 1 {
		msg = unb64(f[1])
	}
	return FromCodes(f[0], msg)
}

// ---------- scanning ----------

// Area is the area to scan, in thousandths of an inch: A4, or less when the
// glass or the feeder is smaller.
func Area(caps *Caps, source string) (width, height int) {
	width, height = A4Width, A4Height
	if caps == nil {
		return width, height
	}
	w, h := caps.BedWidth, caps.BedHeight
	if source == "feeder" {
		w, h = caps.FeedWidth, caps.FeedHeight
	}
	if w > 0 {
		width = min(width, w)
	}
	if h > 0 {
		height = min(height, h)
	}
	return width, height
}

// Nearest picks the resolution in offered closest to want (the higher one
// on a tie), or want when nothing is offered.
func Nearest(offered []int, want int) int {
	if len(offered) == 0 {
		return want
	}
	best := offered[0]
	for _, r := range offered {
		if d, bd := abs(r-want), abs(best-want); d < bd || (d == bd && r > best) {
			best = r
		}
	}
	return best
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// ChooseColorMode picks the colour mode closest to want that the scanner
// offers (all of them when it doesn't say).
func ChooseColorMode(offered []string, want string) string {
	order := map[string][]string{
		"color":     {"color", "grayscale", "bw"},
		"grayscale": {"grayscale", "color", "bw"},
		"bw":        {"bw", "grayscale", "color"},
	}[want]
	if order == nil {
		order = []string{"color", "grayscale", "bw"}
	}
	if len(offered) == 0 {
		return order[0]
	}
	for _, m := range order {
		if slices.Contains(offered, m) {
			return m
		}
	}
	return order[0]
}

// Env is what the scan script is asked, as environment variables.
func Env(id, dir string, s Settings, caps *Caps) []string {
	intent, dataType, depth := 1, 3, 24
	switch s.ColorMode {
	case "grayscale":
		intent, dataType, depth = 2, 2, 8
	case "bw":
		intent, dataType, depth = 4, 0, 1
	}
	source := "platen"
	if s.Source == "feeder" {
		source = "feeder"
	}
	duplex := "0"
	if s.Duplex && source == "feeder" {
		duplex = "1"
	}
	maxPages := s.MaxPages
	if maxPages <= 0 || maxPages > MaxPages {
		maxPages = MaxPages
	}
	if source == "platen" {
		maxPages = 1
	}
	w, h := Area(caps, source)
	return []string{
		"TLX_WIA_DEVICE=" + id,
		"TLX_WIA_OUT=" + dir,
		"TLX_WIA_SOURCE=" + source,
		"TLX_WIA_DUPLEX=" + duplex,
		"TLX_WIA_INTENT=" + strconv.Itoa(intent),
		"TLX_WIA_DATATYPE=" + strconv.Itoa(dataType),
		"TLX_WIA_DEPTH=" + strconv.Itoa(depth),
		"TLX_WIA_DPI=" + strconv.Itoa(s.Resolution),
		"TLX_WIA_WIDTH=" + strconv.Itoa(w*s.Resolution/1000),
		"TLX_WIA_HEIGHT=" + strconv.Itoa(h*s.Resolution/1000),
		"TLX_WIA_MAXPAGES=" + strconv.Itoa(maxPages),
	}
}

var pageName = regexp.MustCompile(`^page-\d{3,4}\.(jpg|jpeg|png|bmp)$`)

// Scan scans with the scanner id and returns its pages.
func (l *Local) Scan(parent context.Context, id string, s Settings, caps *Caps, idle time.Duration) ([]Page, error) {
	if !l.Available() {
		return nil, &Error{Kind: KindNoWIA, Detail: "this computer isn't running Windows"}
	}
	base, err := l.tempDir()
	if err != nil {
		return nil, &Error{Kind: KindDevice, Detail: "the helper couldn't make a folder for the scan", Err: err}
	}
	dir, err := os.MkdirTemp(base, "scan-")
	if err != nil {
		return nil, &Error{Kind: KindDevice, Detail: "the helper couldn't make a folder for the scan", Err: err}
	}
	defer os.RemoveAll(dir)

	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	var timedOut atomic.Bool
	timer := time.AfterFunc(idle, func() { timedOut.Store(true); cancel() })
	defer timer.Stop()

	var (
		pages   []Page
		scanErr *Error
		readErr error
		ended   bool
	)
	runErr := l.Run(ctx, Script("scan"), Env(id, dir, s, caps), func(line string) {
		f := strings.Fields(line)
		if len(f) == 0 {
			return
		}
		switch f[0] {
		case "PAGE":
			timer.Reset(idle)
			if len(f) < 2 || readErr != nil {
				return
			}
			pg, err := readPage(dir, f[1])
			if err != nil {
				readErr = err
				return
			}
			pages = append(pages, pg)
		case "ERR":
			scanErr = parseErr(f[1:])
		case "WARN":
			if len(f) > 1 {
				l.logf("scan warning from Windows: %s", unb64(f[1]))
			}
		case "END":
			ended = true
		}
	})
	switch {
	case timedOut.Load():
		return nil, &Error{Kind: KindTimeout, Err: runErr}
	case parent.Err() != nil:
		return nil, &Error{Kind: KindCanceled, Err: parent.Err()}
	case scanErr != nil:
		return nil, scanErr
	case readErr != nil:
		return nil, &Error{Kind: KindDevice, Detail: "the helper couldn't read the scanned page", Err: readErr}
	case len(pages) == 0 && runErr != nil && !ended:
		return nil, &Error{Kind: KindNoWIA, Detail: "Windows PowerShell didn't run", Err: runErr}
	case len(pages) == 0:
		return nil, &Error{Kind: KindDevice, Detail: "it finished without sending a page"}
	}
	return pages, nil
}

// readPage reads a page the script wrote and deletes it at once.
func readPage(dir, name string) (Page, error) {
	if !pageName.MatchString(name) {
		return Page{}, fmt.Errorf("unexpected page file %q", name)
	}
	path := filepath.Join(dir, name)
	defer os.Remove(path)
	fi, err := os.Stat(path)
	if err != nil {
		return Page{}, err
	}
	if fi.Size() > MaxPageSize {
		return Page{}, errors.New("the page is too large")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Page{}, err
	}
	if len(data) == 0 {
		return Page{}, errors.New("the page is empty")
	}
	return Page{ContentType: contentType(data), Data: data}, nil
}

func contentType(b []byte) string {
	switch {
	case len(b) > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF:
		return "image/jpeg"
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(b, []byte("BM")):
		return "image/bmp"
	}
	return "application/octet-stream"
}
