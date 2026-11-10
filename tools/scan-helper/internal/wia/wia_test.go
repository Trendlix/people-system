package wia

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// b64 writes text as the scripts do: base64, or - when empty.
func b64(s string) string {
	if s == "" {
		return "-"
	}
	return base64.StdEncoding.EncodeToString([]byte(s))
}

const (
	lide = `{6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\0000`
	ads  = `{6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\0001`
)

// fakeRunner answers a script with lines, as PowerShell would, and records
// what it was asked.
type fakeRunner struct {
	script string
	env    map[string]string
	answer func(ctx context.Context, env map[string]string, say func(string)) error
}

func (f *fakeRunner) run(ctx context.Context, script string, env []string, line func(string)) error {
	f.script = script
	f.env = map[string]string{}
	for _, kv := range env {
		k, v, _ := strings.Cut(kv, "=")
		f.env[k] = v
	}
	return f.answer(ctx, f.env, line)
}

func lines(ls ...string) func(context.Context, map[string]string, func(string)) error {
	return func(_ context.Context, _ map[string]string, say func(string)) error {
		for _, l := range ls {
			say(l)
		}
		return nil
	}
}

// ---------- the scripts ----------

func TestScriptsKeepTheirRules(t *testing.T) {
	fn := regexp.MustCompile(`(?i)\bfunction\s+([A-Za-z0-9_-]+)`)
	for _, name := range []string{"list", "scan"} {
		s := Script(name)
		if len(s) < 500 || len(s) > 20000 {
			t.Errorf("%s: %d characters (a Windows command line holds 32,767)", name, len(s))
		}
		if strings.ContainsAny(s, "\"`\r\t") {
			t.Errorf("%s: has a double quote, a backtick, a tab or a carriage return", name)
		}
		for i, line := range strings.Split(strings.TrimSuffix(s, "\n"), "\n") {
			if line == "" || strings.HasPrefix(line, "#") || line != strings.TrimSpace(line) {
				t.Errorf("%s line %d: blank, a comment or indented: %q", name, i+1, line)
			}
			if !strings.HasSuffix(line, ";") && !strings.HasSuffix(line, "{") {
				t.Errorf("%s line %d doesn't end with ; or {: %q", name, i+1, line)
			}
			for _, c := range []rune(line) {
				if c > 126 {
					t.Errorf("%s line %d isn't plain ASCII: %q", name, i+1, line)
					break
				}
			}
		}
		if err := balanced(s); err != nil {
			t.Errorf("%s: %v", name, err)
		}
		for _, m := range fn.FindAllStringSubmatch(s, -1) {
			if !strings.HasPrefix(m[1], "Tlx") {
				t.Errorf("%s: function %s isn't named Tlx...", name, m[1])
			}
		}
		if !strings.HasSuffix(s, "TlxSay 'END';\n") {
			t.Errorf("%s doesn't end by saying END", name)
		}
	}
	// Every variable the helper sets is read by the script, and the other way round.
	read := regexp.MustCompile(`\$env:(TLX_WIA_[A-Z]+)`)
	vars := func(s string) []string {
		var out []string
		for _, m := range read.FindAllStringSubmatch(s, -1) {
			if !slices.Contains(out, m[1]) {
				out = append(out, m[1])
			}
		}
		slices.Sort(out)
		return out
	}
	var set []string
	for _, kv := range Env("id", "dir", Settings{Source: "platen", ColorMode: "color", Resolution: 300}, nil) {
		k, _, _ := strings.Cut(kv, "=")
		set = append(set, k)
	}
	slices.Sort(set)
	if got := vars(Script("scan")); !slices.Equal(got, set) {
		t.Errorf("the scan script reads %v, the helper sets %v", got, set)
	}
	if got := vars(Script("list")); !slices.Equal(got, []string{"TLX_WIA_KNOWN"}) {
		t.Errorf("the list script reads %v", got)
	}
}

// balanced checks (), [] and {} outside single-quoted strings.
func balanced(s string) error {
	var stack []rune
	pair := map[rune]rune{')': '(', ']': '[', '}': '{'}
	in := false
	rs := []rune(s)
	for i := 0; i < len(rs); i++ {
		c := rs[i]
		if in {
			if c == '\'' {
				if i+1 < len(rs) && rs[i+1] == '\'' {
					i++
					continue
				}
				in = false
			}
			continue
		}
		switch c {
		case '\'':
			in = true
		case '(', '[', '{':
			stack = append(stack, c)
		case ')', ']', '}':
			if len(stack) == 0 || stack[len(stack)-1] != pair[c] {
				return errors.New("unbalanced " + string(c) + " near: " + string(rs[max(0, i-40):i+1]))
			}
			stack = stack[:len(stack)-1]
		}
	}
	if in {
		return errors.New("a string isn't closed")
	}
	if len(stack) > 0 {
		return errors.New("unclosed " + string(stack))
	}
	return nil
}

// ---------- listing ----------

func TestList(t *testing.T) {
	f := &fakeRunner{answer: lines(
		"DEV "+b64(lide)+" "+b64("Canon LiDE 300")+" "+b64("Canon")+" "+b64("Canon LiDE 300 (USB)")+" "+b64(`\\.\Usbscan0`),
		"DEV "+b64(ads)+" "+b64("")+" "+b64("Brother")+" "+b64("Brother ADS-1700W")+" "+b64("WSD-1234"),
		"DEV "+b64("{X}\\0002")+" "+b64("ماسح ضوئي")+" "+b64("")+" "+b64("")+" "+b64(""),
		"some stray output",
		"CAPS "+b64(lide)+" src=platen dup=0 res=list:75,150,300,600,4800 types=list:3,2 bed=8500x11690 feed=0x0",
		"WARN "+b64("Property 6151 could not be set to 2480"),
		"CAPSERR "+b64(ads)+" 80131500,80210005 "+b64("The device is offline."),
		"END",
	)}
	var logged []string
	l := &Local{Run: f.run, Logf: func(format string, a ...any) { logged = append(logged, format) }}
	devs, err := l.List(context.Background(), []string{"{X}\\0002"})
	if err != nil {
		t.Fatal(err)
	}
	if f.env["TLX_WIA_KNOWN"] != "{X}\\0002" || !strings.Contains(f.script, "TlxList") {
		t.Errorf("asked %v", f.env)
	}
	if len(devs) != 3 {
		t.Fatalf("devices = %+v", devs)
	}
	d := devs[0]
	if d.ID != lide || d.Name != "Canon LiDE 300" || d.Manufacturer != "Canon" || d.Port != `\\.\Usbscan0` || !d.CapsAsked || d.CapsErr != nil {
		t.Errorf("first = %+v", d)
	}
	want := Caps{Sources: []string{"platen"}, ColorModes: []string{"color", "grayscale"}, Resolutions: []int{75, 150, 300, 600}, BedWidth: 8500, BedHeight: 11690}
	if d.Caps == nil || !equalCaps(*d.Caps, want) {
		t.Errorf("caps = %+v, want %+v", d.Caps, want)
	}
	if devs[1].DisplayName() != "Brother ADS-1700W" || devs[1].Caps != nil || KindOf(devs[1].CapsErr) != KindOffline {
		t.Errorf("second = %+v", devs[1])
	}
	if devs[2].DisplayName() != "ماسح ضوئي" || devs[2].CapsAsked {
		t.Errorf("third = %+v", devs[2])
	}
	if len(logged) != 1 {
		t.Errorf("logged %v", logged)
	}
}

func equalCaps(a, b Caps) bool {
	return slices.Equal(a.Sources, b.Sources) && a.Duplex == b.Duplex && slices.Equal(a.ColorModes, b.ColorModes) &&
		slices.Equal(a.Resolutions, b.Resolutions) && a.BedWidth == b.BedWidth && a.BedHeight == b.BedHeight &&
		a.FeedWidth == b.FeedWidth && a.FeedHeight == b.FeedHeight
}

func TestListProblems(t *testing.T) {
	cases := []struct {
		name   string
		answer func(context.Context, map[string]string, func(string)) error
		kind   Kind
		devs   int
	}{
		{"WIA's scripting library missing", lines("ERR 80131500,80040154 "+b64("Retrieving the COM class factory failed: 80040154 Class not registered"), "END"), KindNoWIA, 0},
		{"WIA service disabled", lines("ERR 80070422 "+b64("The service cannot be started"), "END"), KindNoWIA, 0},
		{"PowerShell didn't start", func(context.Context, map[string]string, func(string)) error {
			return errors.New("exec: file not found")
		}, KindNoWIA, 0},
		{"cut short", lines("DEV " + b64(lide) + " " + b64("Canon")), KindDevice, 1},
	}
	for _, c := range cases {
		l := &Local{Run: (&fakeRunner{answer: c.answer}).run}
		devs, err := l.List(context.Background(), nil)
		if KindOf(err) != c.kind || len(devs) != c.devs {
			t.Errorf("%s: %d devices, %v (kind %d, want %d)", c.name, len(devs), err, KindOf(err), c.kind)
		}
	}

	// Too slow: the devices said before the time ran out are kept.
	l := &Local{ListTimeout: 50 * time.Millisecond, Run: (&fakeRunner{answer: func(ctx context.Context, _ map[string]string, say func(string)) error {
		say("DEV " + b64(lide) + " " + b64("Canon"))
		<-ctx.Done()
		return ctx.Err()
	}}).run}
	devs, err := l.List(context.Background(), nil)
	if len(devs) != 1 || KindOf(err) != KindDevice || !strings.Contains(err.Error(), "took too long") {
		t.Errorf("slow list = %v, %v", devs, err)
	}
}

func TestNothingOutsideWindows(t *testing.T) {
	l := &Local{}
	if l.Available() {
		t.Fatal("no runner, no scanners")
	}
	if devs, err := l.List(context.Background(), nil); devs != nil || err != nil {
		t.Errorf("List = %v, %v", devs, err)
	}
	if _, err := l.Scan(context.Background(), lide, Settings{}, nil, time.Second); KindOf(err) != KindNoWIA {
		t.Errorf("Scan = %v", err)
	}
}

func TestParseCaps(t *testing.T) {
	cases := []struct {
		in   string
		want Caps
	}{
		{"src=platen,feeder dup=1 res=range:50:1200:1 types=list:0,2,3 bed=8500x11700 feed=8500x14000",
			Caps{Sources: []string{"platen", "feeder"}, Duplex: true, ColorModes: []string{"color", "grayscale", "bw"},
				Resolutions: []int{75, 100, 150, 200, 240, 300, 400, 600, 1200}, BedWidth: 8500, BedHeight: 11700, FeedWidth: 8500, FeedHeight: 14000}},
		{"src=platen dup=1 res=range:100:600:100 types=value:3",
			Caps{Sources: []string{"platen"}, ColorModes: []string{"color"}, Resolutions: []int{100, 200, 300, 400, 600}}},
		{"src=feeder res=range:250:275:5 types=range:0:3:1",
			Caps{Sources: []string{"feeder"}, Resolutions: []int{250, 275}}},
		{"src= res= types= bed=bad feed=1x",
			Caps{Sources: []string{"platen"}}},
		{"res=value:300 types=list:1",
			Caps{Sources: []string{"platen"}, Resolutions: []int{300}, ColorModes: []string{"bw"}}},
	}
	for _, c := range cases {
		if got := ParseCaps(strings.Fields(c.in)); !equalCaps(*got, c.want) {
			t.Errorf("%s:\n got %+v\nwant %+v", c.in, *got, c.want)
		}
	}
}

// ---------- errors ----------

func TestErrorsFromWindows(t *testing.T) {
	cases := []struct {
		codes, msg string
		kind       Kind
		code       uint32
		detail     string
	}{
		{"80131500,80210003", "", KindFeederEmpty, 0x80210003, ""},
		{"80020009,80210006", "", KindBusy, 0x80210006, ""},
		{"8021000D", "", KindBusy, 0x8021000D, ""},
		{"80210007", "", KindWarmingUp, 0x80210007, ""},
		{"80210005", "", KindOffline, 0x80210005, ""},
		{"8021000A", "", KindOffline, 0x8021000A, ""},
		{"80210015", "", KindOffline, 0x80210015, ""},
		{"80210009", "", KindNotFound, 0x80210009, ""},
		{"80210002", "", KindDevice, 0x80210002, "paper is stuck in it"},
		{"80210016", "", KindDevice, 0x80210016, "its cover is open"},
		{"80210017", "", KindDevice, 0x80210017, "its lamp is off"},
		{"80210020", "", KindDevice, 0x80210020, "it pulled in more than one page at a time"},
		{"80210004", "", KindDevice, 0x80210004, "there is a problem with the paper"},
		{"80210008", "", KindDevice, 0x80210008, "it needs attention (look at the scanner)"},
		{"80131500,80040154", "", KindNoWIA, 0x80040154, ""},
		{"80070422", "", KindNoWIA, 0x80070422, ""},
		{"80131500", "Exception from HRESULT: 0x80210003", KindFeederEmpty, 0x80210003, ""},
		{"80131500,80004005", "", KindDevice, 0x80004005, "Windows reported error 0x80004005"},
		{"80131500,8007001F", "A device attached to the system is not functioning.", KindDevice, 0x8007001F, "Windows reported error 0x8007001F"},
		{"80131501", "Cannot create type. Only core types are supported in this language mode.", KindDevice, 0x80131501,
			"this computer's security settings don't let the helper use Windows' scanning (PowerShell's constrained language mode)"},
		{"", "", KindDevice, 0, "something went wrong in Windows' scanning"},
		{"zz", "", KindDevice, 0, "something went wrong in Windows' scanning"},
	}
	for _, c := range cases {
		e := FromCodes(c.codes, c.msg)
		if e.Kind != c.kind || (c.detail != "" && e.Detail != c.detail) {
			t.Errorf("%s %q: %+v, want kind %d %q", c.codes, c.msg, e, c.kind, c.detail)
		}
	}
	if got := PickCode("80131500,80004005", ""); got != 0x80004005 {
		t.Errorf("PickCode = %X", got)
	}
	for in, want := range map[string]Kind{"NOTFOUND": KindNotFound, "NOFEEDER": KindNoFeeder, "NOFLATBED": KindNoFlatbed} {
		if got := parseErr([]string{in}).Kind; got != want {
			t.Errorf("ERR %s = %d", in, got)
		}
	}
	if e := (&Error{Kind: KindDevice, Code: 0x80210016, Detail: "its cover is open"}); e.Error() != "scanner error: its cover is open (0x80210016)" {
		t.Errorf("Error() = %q", e.Error())
	}
}

// ---------- scanning ----------

var jpegBytes = []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xD9}

// writesPages is a script that writes n pages, a delay apart.
func writesPages(t *testing.T, n int, delay time.Duration, ext string) func(context.Context, map[string]string, func(string)) error {
	return func(ctx context.Context, env map[string]string, say func(string)) error {
		for i := 1; i <= n; i++ {
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return ctx.Err()
			}
			name := "page-00" + string(rune('0'+i)) + "." + ext
			data := jpegBytes
			if ext == "png" {
				data = []byte("\x89PNG\r\n\x1a\nrest")
			}
			if err := os.WriteFile(filepath.Join(env["TLX_WIA_OUT"], name), data, 0o600); err != nil {
				t.Error(err)
			}
			say("PAGE " + name)
		}
		say("DONE " + string(rune('0'+n)))
		say("END")
		return nil
	}
}

func TestScan(t *testing.T) {
	tmp := t.TempDir()
	f := &fakeRunner{answer: writesPages(t, 3, 10*time.Millisecond, "jpg")}
	l := &Local{Run: f.run, TempDir: tmp}
	caps := &Caps{Sources: []string{"feeder"}, FeedWidth: 8500, FeedHeight: 14000}
	pages, err := l.Scan(context.Background(), ads, Settings{Source: "feeder", Duplex: true, ColorMode: "grayscale", Resolution: 300}, caps, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 3 || pages[0].ContentType != "image/jpeg" || string(pages[2].Data) != string(jpegBytes) {
		t.Errorf("pages = %d %+v", len(pages), pages[0].ContentType)
	}
	want := map[string]string{
		"TLX_WIA_DEVICE": ads, "TLX_WIA_SOURCE": "feeder", "TLX_WIA_DUPLEX": "1",
		"TLX_WIA_INTENT": "2", "TLX_WIA_DATATYPE": "2", "TLX_WIA_DEPTH": "8", "TLX_WIA_DPI": "300",
		"TLX_WIA_WIDTH": "2480", "TLX_WIA_HEIGHT": "3507", "TLX_WIA_MAXPAGES": "300",
	}
	for k, v := range want {
		if f.env[k] != v {
			t.Errorf("%s = %q, want %q", k, f.env[k], v)
		}
	}
	if !strings.HasPrefix(f.env["TLX_WIA_OUT"], filepath.Join(tmp, "scan-")) || !strings.Contains(f.script, "TlxScan") {
		t.Errorf("out = %q", f.env["TLX_WIA_OUT"])
	}
	// Nothing scanned stays on disk.
	if left, _ := os.ReadDir(tmp); len(left) != 0 {
		t.Errorf("left behind: %v", left)
	}
}

func TestEnv(t *testing.T) {
	get := func(env []string, k string) string {
		for _, kv := range env {
			if key, v, _ := strings.Cut(kv, "="); key == k {
				return v
			}
		}
		return ""
	}
	// The glass: one page, A4 or the glass when it is smaller.
	env := Env(lide, "d", Settings{Source: "platen", Duplex: true, ColorMode: "color", Resolution: 600, MaxPages: 10}, &Caps{BedWidth: 8500, BedHeight: 11000})
	for k, v := range map[string]string{"TLX_WIA_SOURCE": "platen", "TLX_WIA_DUPLEX": "0", "TLX_WIA_MAXPAGES": "1", "TLX_WIA_INTENT": "1",
		"TLX_WIA_DATATYPE": "3", "TLX_WIA_DEPTH": "24", "TLX_WIA_WIDTH": "4960", "TLX_WIA_HEIGHT": "6600"} {
		if got := get(env, k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	env = Env(lide, "d", Settings{Source: "feeder", ColorMode: "bw", Resolution: 200, MaxPages: 10}, nil)
	for k, v := range map[string]string{"TLX_WIA_SOURCE": "feeder", "TLX_WIA_MAXPAGES": "10", "TLX_WIA_INTENT": "4", "TLX_WIA_DATATYPE": "0",
		"TLX_WIA_DEPTH": "1", "TLX_WIA_WIDTH": "1653", "TLX_WIA_HEIGHT": "2338"} {
		if got := get(env, k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	if w, h := Area(&Caps{BedWidth: 8500, BedHeight: 14000}, "platen"); w != A4Width || h != A4Height {
		t.Errorf("Area = %d x %d", w, h)
	}
	if got := Nearest([]int{75, 150, 300, 600}, 250); got != 300 {
		t.Errorf("Nearest = %d", got)
	}
	if got := Nearest([]int{100, 200}, 150); got != 200 {
		t.Errorf("Nearest on a tie = %d", got)
	}
	if got := Nearest(nil, 250); got != 250 {
		t.Errorf("Nearest of nothing = %d", got)
	}
	for _, c := range []struct {
		offered     []string
		want, wants string
	}{
		{[]string{"color", "grayscale"}, "bw", "grayscale"},
		{[]string{"bw"}, "color", "bw"},
		{nil, "grayscale", "grayscale"},
		{[]string{"grayscale"}, "sepia", "grayscale"},
	} {
		if got := ChooseColorMode(c.offered, c.want); got != c.wants {
			t.Errorf("ChooseColorMode(%v, %s) = %s", c.offered, c.want, got)
		}
	}
}

func TestScanProblems(t *testing.T) {
	cases := []struct {
		name   string
		answer func(context.Context, map[string]string, func(string)) error
		kind   Kind
	}{
		{"unplugged", lines("ERR NOTFOUND", "END"), KindNotFound},
		{"no feeder", lines("ERR NOFEEDER", "END"), KindNoFeeder},
		{"feeder empty", lines("ERR 80131500,80210003 "+b64("Exception from HRESULT: 0x80210003"), "END"), KindFeederEmpty},
		{"paper jam", lines("ERR 80210002 "+b64("jam"), "END"), KindDevice},
		{"no page", lines("DONE 0", "END"), KindDevice},
		{"PowerShell didn't start", func(context.Context, map[string]string, func(string)) error { return errors.New("exec: not found") }, KindNoWIA},
		{"a page the helper didn't ask for", lines("PAGE ..\\..\\secret.txt", "DONE 1", "END"), KindDevice},
		{"a page that isn't there", lines("PAGE page-001.jpg", "DONE 1", "END"), KindDevice},
	}
	for _, c := range cases {
		l := &Local{Run: (&fakeRunner{answer: c.answer}).run, TempDir: t.TempDir()}
		_, err := l.Scan(context.Background(), lide, Settings{Source: "platen", Resolution: 300}, nil, time.Second)
		if KindOf(err) != c.kind {
			t.Errorf("%s: %v (kind %d, want %d)", c.name, err, KindOf(err), c.kind)
		}
	}
}

func TestScanTimeoutRestartsWithEachPage(t *testing.T) {
	// Five pages 60 ms apart take longer than the 200 ms without progress
	// allowed, and pass: the time restarts with each page.
	l := &Local{Run: (&fakeRunner{answer: writesPages(t, 5, 60*time.Millisecond, "png")}).run, TempDir: t.TempDir()}
	pages, err := l.Scan(context.Background(), ads, Settings{Source: "feeder", Resolution: 300}, nil, 200*time.Millisecond)
	if err != nil || len(pages) != 5 || pages[0].ContentType != "image/png" {
		t.Fatalf("pages = %d, %v", len(pages), err)
	}

	// A scanner that never sends a page is stopped.
	var stopped atomic.Bool
	l = &Local{TempDir: t.TempDir(), Run: (&fakeRunner{answer: func(ctx context.Context, _ map[string]string, _ func(string)) error {
		<-ctx.Done()
		stopped.Store(true)
		return ctx.Err()
	}}).run}
	start := time.Now()
	_, err = l.Scan(context.Background(), lide, Settings{Source: "platen", Resolution: 300}, nil, 100*time.Millisecond)
	if KindOf(err) != KindTimeout || !stopped.Load() || time.Since(start) > 2*time.Second {
		t.Errorf("stuck scan = %v after %v", err, time.Since(start))
	}

	// The web page stops waiting.
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)
	l.TempDir = t.TempDir()
	if _, err := l.Scan(ctx, lide, Settings{Source: "platen", Resolution: 300}, nil, time.Minute); KindOf(err) != KindCanceled {
		t.Errorf("cancelled scan = %v", err)
	}
}

func TestCleanTemp(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "scan-123", "x"), 0o700)
	os.WriteFile(filepath.Join(dir, "scan-123", "page-001.jpg"), jpegBytes, 0o600)
	os.WriteFile(filepath.Join(dir, "keep.txt"), nil, 0o600)
	CleanTemp(dir)
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || entries[0].Name() != "keep.txt" {
		t.Errorf("left %v", entries)
	}
	CleanTemp(filepath.Join(dir, "missing")) // no folder: nothing to do
}

func TestDisplayName(t *testing.T) {
	for d, want := range map[Device]string{
		{Name: " Canon LiDE 300 "}:    "Canon LiDE 300",
		{Description: "EPSON DS-530"}: "EPSON DS-530",
		{Manufacturer: "Plustek"}:     "Plustek scanner",
		{}:                            "Scanner on this computer",
	} {
		if got := d.DisplayName(); got != want {
			t.Errorf("%+v: %q", d, got)
		}
	}
}
