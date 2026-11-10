package escl_test

import (
	"context"
	"encoding/xml"
	"net"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"trendlix.com/scan-helper/internal/escl"
	"trendlix.com/scan-helper/internal/escltest"
	"trendlix.com/scan-helper/internal/paper"
	"trendlix.com/scan-helper/internal/progress"
)

func TestParseCapabilitiesPlatenAndDuplexFeeder(t *testing.T) {
	c, err := escl.ParseCapabilities([]byte(escltest.HPCapabilities))
	if err != nil {
		t.Fatal(err)
	}
	if c.MakeAndModel != "HP LaserJet MFP M428fdw" || c.Version != "2.63" || c.UUID != "564e4333-4c30-3846-3434-a0481c9f1234" {
		t.Errorf("identity = %q %q %q", c.MakeAndModel, c.Version, c.UUID)
	}
	if c.Platen == nil || c.Feeder == nil {
		t.Fatalf("platen=%v feeder=%v", c.Platen, c.Feeder)
	}
	if c.Platen.MaxWidth != 2550 || c.Platen.MaxHeight != 3508 || c.Feeder.MaxHeight != 4200 {
		t.Errorf("sizes: platen %dx%d feeder %dx%d", c.Platen.MaxWidth, c.Platen.MaxHeight, c.Feeder.MaxWidth, c.Feeder.MaxHeight)
	}
	if !c.Duplex {
		t.Error("duplex should be true")
	}
	if got := c.Sources(); !slices.Equal(got, []string{"platen", "feeder"}) {
		t.Errorf("sources = %v", got)
	}
	if got := c.ColorModes(); !slices.Equal(got, []string{"color", "grayscale", "bw"}) {
		t.Errorf("colorModes = %v", got)
	}
	if got := c.Resolutions(); !slices.Equal(got, []int{75, 100, 200, 300, 600}) {
		t.Errorf("resolutions = %v", got)
	}
	if got := c.Feeder.Resolutions; !slices.Equal(got, []int{100, 200, 300}) {
		t.Errorf("feeder resolutions = %v", got)
	}
	if got := c.Formats(); !slices.Equal(got, []string{"application/octet-stream", "image/jpeg", "application/pdf"}) {
		t.Errorf("formats = %v", got)
	}
}

func TestParseCapabilitiesRangeAndProfileRef(t *testing.T) {
	c, err := escl.ParseCapabilities([]byte(escltest.PlatenPDFCapabilities))
	if err != nil {
		t.Fatal(err)
	}
	if c.Feeder != nil || c.Duplex {
		t.Error("expected platen only, no duplex")
	}
	if got := c.Sources(); !slices.Equal(got, []string{"platen"}) {
		t.Errorf("sources = %v", got)
	}
	if got := c.Resolutions(); !slices.Equal(got, []int{75, 100, 150, 200, 300, 400, 600}) {
		t.Errorf("resolutions = %v", got)
	}
	if got := c.ColorModes(); !slices.Equal(got, []string{"color", "grayscale"}) {
		t.Errorf("colorModes = %v", got)
	}
	if f, ok := escl.ChooseFormat(c.Platen); !ok || f != "application/pdf" {
		t.Errorf("format = %q %v", f, ok)
	}
	if w, h := escl.Region(c.Platen, paper.Size{}); w != 2480 || h != 3295 {
		t.Errorf("region = %dx%d, want A4 width clamped to max height", w, h)
	}
}

func TestParseCapabilitiesRejectsOtherDocuments(t *testing.T) {
	for _, doc := range []string{
		"",
		"<html><body>Printer home page</body></html>",
		`<?xml version="1.0"?><scan:ScannerCapabilities xmlns:scan="x"><pwg:Version xmlns:pwg="y">2.0</pwg:Version></scan:ScannerCapabilities>`,
		"not xml at all",
	} {
		if _, err := escl.ParseCapabilities([]byte(doc)); err == nil {
			t.Errorf("expected an error for %q", doc)
		}
	}
}

func TestChoices(t *testing.T) {
	in := &escl.InputCaps{ColorModes: []string{"Grayscale8", "RGB24"}, Resolutions: []int{100, 200, 300, 600}}
	if got := escl.ChooseColorMode(in, "bw"); got != "Grayscale8" {
		t.Errorf("bw without BlackAndWhite1 = %q, want Grayscale8", got)
	}
	if got := escl.ChooseColorMode(in, "color"); got != "RGB24" {
		t.Errorf("color = %q", got)
	}
	if got := escl.ChooseColorMode(nil, "bw"); got != "BlackAndWhite1" {
		t.Errorf("bw unknown caps = %q", got)
	}
	for in2, want := range map[int]int{300: 300, 250: 300, 150: 200, 1200: 600, 50: 100} {
		if got := escl.ChooseResolution(in, in2); got != want {
			t.Errorf("ChooseResolution(%d) = %d, want %d", in2, got, want)
		}
	}
}

func TestScanSettingsXML(t *testing.T) {
	s := escl.ScanSettings{Version: "2.63", Source: escl.SourceFeeder, Duplex: true, ColorMode: "RGB24", Resolution: 300, Format: "image/jpeg", Width: 2480, Height: 3508}
	doc := string(s.XML())
	var x struct {
		XMLName    xml.Name
		Version    string `xml:"Version"`
		Intent     string `xml:"Intent"`
		Units      string `xml:"ScanRegions>ScanRegion>ContentRegionUnits"`
		Width      int    `xml:"ScanRegions>ScanRegion>Width"`
		Height     int    `xml:"ScanRegions>ScanRegion>Height"`
		Source     string `xml:"InputSource"`
		Mode       string `xml:"ColorMode"`
		XRes       int    `xml:"XResolution"`
		YRes       int    `xml:"YResolution"`
		Format     string `xml:"DocumentFormat"`
		FormatExt  string `xml:"DocumentFormatExt"`
		DuplexText string `xml:"Duplex"`
	}
	if err := xml.Unmarshal([]byte(doc), &x); err != nil {
		t.Fatalf("not well-formed: %v\n%s", err, doc)
	}
	if x.XMLName.Local != "ScanSettings" || x.Version != "2.63" || x.Intent != "Document" ||
		x.Units != "escl:ThreeHundredthsOfInches" || x.Width != 2480 || x.Height != 3508 ||
		x.Source != "Feeder" || x.Mode != "RGB24" || x.XRes != 300 || x.YRes != 300 ||
		x.Format != "image/jpeg" || x.FormatExt != "image/jpeg" || x.DuplexText != "true" {
		t.Errorf("unexpected settings: %+v\n%s", x, doc)
	}
	platen := escl.ScanSettings{Source: escl.SourcePlaten, ColorMode: "Grayscale8", Resolution: 200, Format: "image/jpeg"}
	if d := string(platen.XML()); strings.Contains(d, "Duplex") || !strings.Contains(d, "<pwg:Version>2.0</pwg:Version>") {
		t.Errorf("platen settings: %s", d)
	}
}

func TestJobURL(t *testing.T) {
	cases := []struct{ base, loc, want string }{
		{"http://192.168.1.23/eSCL", "http://192.168.1.23/eSCL/ScanJobs/abc", "http://192.168.1.23/eSCL/ScanJobs/abc"},
		{"http://192.168.1.23/eSCL", "/eSCL/ScanJobs/abc", "http://192.168.1.23/eSCL/ScanJobs/abc"},
		{"http://192.168.1.23/eSCL", "ScanJobs/abc/", "http://192.168.1.23/eSCL/ScanJobs/abc"},
		{"https://192.168.1.23:8443/eSCL", "http://localhost/eSCL/ScanJobs/7", "https://192.168.1.23:8443/eSCL/ScanJobs/7"},
	}
	for _, c := range cases {
		if got, err := escl.JobURL(c.base, c.loc); err != nil || got != c.want {
			t.Errorf("JobURL(%q, %q) = %q, %v; want %q", c.base, c.loc, got, err, c.want)
		}
	}
}

func TestCapabilitiesOverSelfSignedHTTPS(t *testing.T) {
	f := (&escltest.Scanner{}).Start(true)
	defer f.Close()
	c := escl.NewClient("test")
	caps, err := c.Capabilities(context.Background(), f.BaseURL())
	if err != nil {
		t.Fatalf("a self-signed LAN scanner should be accepted: %v", err)
	}
	if caps.MakeAndModel != "HP LaserJet MFP M428fdw" {
		t.Errorf("model = %q", caps.MakeAndModel)
	}
}

func TestScanFeederWithWrongLocationHost(t *testing.T) {
	f := &escltest.Scanner{FeederPages: 2, LocationHost: "printer.invalid"}
	f.Start(false)
	defer f.Close()
	c := escl.NewClient("test")
	docs, err := c.Scan(context.Background(), f.BaseURL(), escl.ScanSettings{Source: escl.SourceFeeder, ColorMode: "RGB24", Resolution: 300, Format: "image/jpeg", Width: 2480, Height: 3508}, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 2 {
		t.Errorf("pages = %d, want 2", len(docs))
	}
}

// A scanner that drops the scan request once (a printer that closed the
// connection, or was waking up) still scans: the request is sent once more.
func TestScanRetriesAStartThatGotNoAnswer(t *testing.T) {
	f := &escltest.Scanner{DropScanJobs: 1}
	f.Start(false)
	defer f.Close()
	c := escl.NewClient("test")
	c.RetryWait = 10 * time.Millisecond
	docs, err := c.Scan(context.Background(), f.BaseURL(), escl.ScanSettings{Source: escl.SourcePlaten, ColorMode: "RGB24", Resolution: 300, Format: "image/jpeg", Width: 2480, Height: 3508}, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 1 {
		t.Errorf("pages = %d, want 1", len(docs))
	}
}

// Asked once more only: a scanner that never answers is reported as not answering.
func TestScanGivesUpAfterOneRetry(t *testing.T) {
	f := &escltest.Scanner{DropScanJobs: 2}
	f.Start(false)
	defer f.Close()
	c := escl.NewClient("test")
	c.RetryWait = 10 * time.Millisecond
	_, err := c.Scan(context.Background(), f.BaseURL(), escl.ScanSettings{Source: escl.SourcePlaten, ColorMode: "RGB24", Resolution: 300, Format: "image/jpeg", Width: 2480, Height: 3508}, 5*time.Second)
	if escl.KindOf(err) != escl.KindUnreachable {
		t.Fatalf("err = %v, want unreachable", err)
	}
}

// Every request to a scanner goes on a new connection: printers drop kept-open
// ones without saying so (Xerox WorkCentre 3335, 1 November 2026).
func TestNoKeptOpenConnections(t *testing.T) {
	tr, ok := escl.NewHTTPClient().Transport.(*http.Transport)
	if !ok || !tr.DisableKeepAlives {
		t.Fatal("the scanner client keeps connections open between requests")
	}
}

func TestIsLANAddress(t *testing.T) {
	for ip, want := range map[string]bool{
		"192.168.1.50": true, "10.0.0.7": true, "172.20.1.1": true, "127.0.0.1": true,
		"169.254.3.4": true, "fe80::1": true, "fd00::5": true,
		"8.8.8.8": false, "142.250.1.1": false, "2001:4860::8888": false,
	} {
		if got := escl.IsLANAddress(net.ParseIP(ip)); got != want {
			t.Errorf("IsLANAddress(%s) = %v, want %v", ip, got, want)
		}
	}
}

// The area asked is sent as the scan region, in 1/300 inch from the origin
// corner, reduced to the glass (or the feeder) and raised to its minimum.
func TestScanRegionFromSize(t *testing.T) {
	c, err := escl.ParseCapabilities([]byte(escltest.HPCapabilities)) // glass 2550 x 3508, feeder 2550 x 4200 (591 at least)
	if err != nil {
		t.Fatal(err)
	}
	if w, h := paper.A4.In300ths(); w != escl.A4Width || h != escl.A4Height {
		t.Errorf("A4 = %d x %d, want %d x %d", w, h, escl.A4Width, escl.A4Height)
	}
	cases := []struct {
		name string
		in   *escl.InputCaps
		size paper.Size
		w, h int
	}{
		{"no size: A4, as before", c.Platen, paper.Size{}, 2480, 3508},
		{"A4", c.Platen, paper.A4, 2480, 3508},
		{"A5", c.Platen, paper.A5, 1748, 2480},
		{"Letter", c.Platen, paper.Letter, 2550, 3300},
		{"100 x 150 mm", c.Platen, paper.Size{W: 10000, H: 15000}, 1181, 1772},
		{"larger than the glass", c.Platen, paper.Size{W: 40000, H: 50000}, 2550, 3508},
		{"feeder, A5", c.Feeder, paper.A5, 1748, 2480},
		{"feeder, larger", c.Feeder, paper.Size{W: 30000, H: 40000}, 2550, 4200},
		{"feeder, smaller than its smallest page", c.Feeder, paper.Size{W: 2000, H: 2000}, 591, 591},
		{"unknown source", nil, paper.A5, 1748, 2480},
	}
	for _, cs := range cases {
		w, h := escl.Region(cs.in, cs.size)
		if w != cs.w || h != cs.h {
			t.Errorf("%s: region = %d x %d, want %d x %d", cs.name, w, h, cs.w, cs.h)
			continue
		}
		// As the scanner reads it.
		s := escl.ScanSettings{Version: "2.63", Source: escl.SourcePlaten, ColorMode: "RGB24", Resolution: 300, Format: "image/jpeg", Width: w, Height: h}
		var x struct {
			Units   string `xml:"ScanRegions>ScanRegion>ContentRegionUnits"`
			Width   int    `xml:"ScanRegions>ScanRegion>Width"`
			Height  int    `xml:"ScanRegions>ScanRegion>Height"`
			XOffset int    `xml:"ScanRegions>ScanRegion>XOffset"`
			YOffset int    `xml:"ScanRegions>ScanRegion>YOffset"`
			XRes    int    `xml:"XResolution"`
		}
		if err := xml.Unmarshal(s.XML(), &x); err != nil {
			t.Fatalf("%s: %v", cs.name, err)
		}
		if x.Units != "escl:ThreeHundredthsOfInches" || x.Width != cs.w || x.Height != cs.h || x.XOffset != 0 || x.YOffset != 0 || x.XRes != 300 {
			t.Errorf("%s: ScanSettings say %+v", cs.name, x)
		}
	}
	if got := c.Sizes(); !slices.Equal(got, []string{"A4", "A5", "Letter"}) {
		t.Errorf("sizes = %v", got)
	}
	pdfOnly, _ := escl.ParseCapabilities([]byte(escltest.PlatenPDFCapabilities)) // glass 279 mm long
	if got := pdfOnly.Sizes(); !slices.Equal(got, []string{"A5", "Letter"}) {
		t.Errorf("sizes of a Letter glass = %v", got)
	}
	if got := (&escl.Capabilities{Feeder: &escl.InputCaps{MaxWidth: 2550, MaxHeight: 2600}}).Sizes(); !slices.Equal(got, []string{"A5"}) {
		t.Errorf("sizes of a feeder-only scanner = %v", got)
	}
}

// A scan says where it stands: connecting, then each page scanned and on its
// way.
func TestScanReportsProgress(t *testing.T) {
	f := &escltest.Scanner{FeederPages: 2}
	f.Start(false)
	defer f.Close()
	var got []string
	ctx := progress.With(context.Background(), func(stage string, page int) {
		got = append(got, stage+" "+strconv.Itoa(page))
	})
	docs, err := escl.NewClient("test").Scan(ctx, f.BaseURL(), escl.ScanSettings{Source: escl.SourceFeeder, ColorMode: "RGB24", Resolution: 300, Format: "image/jpeg", Width: 1748, Height: 2480}, 5*time.Second)
	if err != nil || len(docs) != 2 {
		t.Fatalf("scan = %d pages, %v", len(docs), err)
	}
	want := []string{"connecting 0", "scanning 1", "transferring 1", "scanning 2", "transferring 2", "scanning 3"}
	if !slices.Equal(got, want) {
		t.Errorf("progress = %v, want %v", got, want)
	}
	if s := f.Settings()[0]; !strings.Contains(s, "<pwg:Width>1748</pwg:Width>") || !strings.Contains(s, "<pwg:Height>2480</pwg:Height>") {
		t.Errorf("the scanner was asked\n%s", s)
	}
}
