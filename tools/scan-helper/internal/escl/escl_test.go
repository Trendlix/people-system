package escl_test

import (
	"context"
	"encoding/xml"
	"net"
	"slices"
	"strings"
	"testing"
	"time"

	"trendlix.com/scan-helper/internal/escl"
	"trendlix.com/scan-helper/internal/escltest"
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
	if w, h := escl.Region(c.Platen); w != 2480 || h != 3295 {
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
