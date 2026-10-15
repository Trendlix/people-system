// Package escl talks to network scanners with eSCL (Mopria / Apple AirScan):
// it reads their capabilities and runs scan jobs over HTTP(S).
package escl

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"
)

// Input sources as eSCL names them in ScanSettings.
const (
	SourcePlaten = "Platen"
	SourceFeeder = "Feeder"
)

// A4 in 1/300 inch, the scan area we ask for unless the scanner is smaller.
const (
	A4Width  = 2480
	A4Height = 3508
)

// Capabilities is what a scanner says it can do (eSCL ScannerCapabilities).
type Capabilities struct {
	Version      string
	MakeAndModel string
	UUID         string
	Platen       *InputCaps // nil when the scanner has no glass
	Feeder       *InputCaps // nil when it has no document feeder
	Duplex       bool       // the feeder can scan both sides
}

// InputCaps describes one input source (the glass or the feeder).
type InputCaps struct {
	MaxWidth    int      // in 1/300 inch, 0 when unknown
	MaxHeight   int      // in 1/300 inch, 0 when unknown
	ColorModes  []string // eSCL names: RGB24, Grayscale8, BlackAndWhite1, ...
	Resolutions []int    // dpi, ascending
	Formats     []string // MIME types, e.g. image/jpeg, application/pdf
}

// standardResolutions are offered when a scanner gives a resolution range
// instead of a list.
var standardResolutions = []int{75, 100, 150, 200, 300, 400, 600, 1200}

type xmlCapabilities struct {
	XMLName      xml.Name
	Version      string       `xml:"Version"`
	MakeAndModel string       `xml:"MakeAndModel"`
	UUID         string       `xml:"UUID"`
	Profiles     []xmlProfile `xml:"SettingProfiles>SettingProfile"`
	Platen       *struct {
		Caps *xmlInputCaps `xml:"PlatenInputCaps"`
	} `xml:"Platen"`
	Adf *struct {
		Simplex *xmlInputCaps `xml:"AdfSimplexInputCaps"`
		Duplex  *xmlInputCaps `xml:"AdfDuplexInputCaps"`
		Options []string      `xml:"AdfOptions>AdfOption"`
	} `xml:"Adf"`
}

type xmlInputCaps struct {
	MaxWidth  string       `xml:"MaxWidth"`
	MaxHeight string       `xml:"MaxHeight"`
	Profiles  []xmlProfile `xml:"SettingProfiles>SettingProfile"`
}

type xmlProfile struct {
	Name       string   `xml:"name,attr"`
	Ref        string   `xml:"ref,attr"`
	ColorModes []string `xml:"ColorModes>ColorMode"`
	Formats    []string `xml:"DocumentFormats>DocumentFormat"`
	FormatsExt []string `xml:"DocumentFormats>DocumentFormatExt"`
	Discrete   []struct {
		X string `xml:"XResolution"`
		Y string `xml:"YResolution"`
	} `xml:"SupportedResolutions>DiscreteResolutions>DiscreteResolution"`
	Ranges []struct {
		Min    string `xml:"XResolutionRange>Min"`
		Max    string `xml:"XResolutionRange>Max"`
		Normal string `xml:"XResolutionRange>Normal"`
	} `xml:"SupportedResolutions>ResolutionRange"`
}

// ParseCapabilities reads an eSCL ScannerCapabilities document.
func ParseCapabilities(data []byte) (*Capabilities, error) {
	var x xmlCapabilities
	dec := xml.NewDecoder(bytes.NewReader(data))
	// Some scanners declare ISO-8859-1 or US-ASCII; the content we read is
	// plain ASCII either way.
	dec.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil }
	if err := dec.Decode(&x); err != nil {
		return nil, fmt.Errorf("the answer isn't eSCL scanner capabilities: %w", err)
	}
	if x.XMLName.Local != "ScannerCapabilities" {
		return nil, fmt.Errorf("the answer is <%s>, not eSCL scanner capabilities", x.XMLName.Local)
	}

	// Profiles can be defined once at the top and referenced by name.
	named := map[string]xmlProfile{}
	for _, p := range x.Profiles {
		if p.Name != "" {
			named[p.Name] = p
		}
	}

	c := &Capabilities{
		Version:      strings.TrimSpace(x.Version),
		MakeAndModel: strings.TrimSpace(x.MakeAndModel),
		UUID:         strings.TrimSpace(x.UUID),
	}
	if x.Platen != nil && x.Platen.Caps != nil {
		c.Platen = convertInput(x.Platen.Caps, named)
	}
	if x.Adf != nil {
		in := x.Adf.Simplex
		if in == nil {
			in = x.Adf.Duplex
		}
		if in != nil {
			c.Feeder = convertInput(in, named)
		}
		c.Duplex = x.Adf.Duplex != nil
		for _, o := range x.Adf.Options {
			if strings.EqualFold(strings.TrimSpace(o), "Duplex") {
				c.Duplex = true
			}
		}
		if c.Feeder == nil {
			c.Duplex = false
		}
	}
	if c.Platen == nil && c.Feeder == nil {
		return nil, errors.New("the scanner lists neither a glass nor a document feeder")
	}
	return c, nil
}

func convertInput(in *xmlInputCaps, named map[string]xmlProfile) *InputCaps {
	ic := &InputCaps{
		MaxWidth:    atoi(in.MaxWidth),
		MaxHeight:   atoi(in.MaxHeight),
		ColorModes:  []string{},
		Resolutions: []int{},
		Formats:     []string{},
	}
	addRes := func(r int) {
		if r > 0 && !slices.Contains(ic.Resolutions, r) {
			ic.Resolutions = append(ic.Resolutions, r)
		}
	}
	for _, p := range in.Profiles {
		if p.Ref != "" {
			if np, ok := named[p.Ref]; ok {
				p = np
			}
		}
		for _, m := range p.ColorModes {
			if m = strings.TrimSpace(m); m != "" && !slices.Contains(ic.ColorModes, m) {
				ic.ColorModes = append(ic.ColorModes, m)
			}
		}
		for _, f := range append(slices.Clone(p.Formats), p.FormatsExt...) {
			if f = strings.ToLower(strings.TrimSpace(f)); f != "" && !slices.Contains(ic.Formats, f) {
				ic.Formats = append(ic.Formats, f)
			}
		}
		for _, d := range p.Discrete {
			addRes(atoi(d.X))
		}
		for _, r := range p.Ranges {
			lo, hi := atoi(r.Min), atoi(r.Max)
			for _, s := range standardResolutions {
				if s >= lo && s <= hi {
					addRes(s)
				}
			}
			addRes(atoi(r.Normal))
		}
	}
	slices.Sort(ic.Resolutions)
	return ic
}

func atoi(s string) int {
	s = strings.TrimSpace(s)
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return int(f)
	}
	return 0
}

// Input returns the capabilities of a source ("platen" or "feeder").
func (c *Capabilities) Input(source string) *InputCaps {
	switch strings.ToLower(source) {
	case "platen":
		return c.Platen
	case "feeder":
		return c.Feeder
	}
	return nil
}

func (c *Capabilities) inputs() []*InputCaps {
	var out []*InputCaps
	for _, in := range []*InputCaps{c.Platen, c.Feeder} {
		if in != nil {
			out = append(out, in)
		}
	}
	return out
}

// Sources lists the input sources in the helper's API terms.
func (c *Capabilities) Sources() []string {
	out := []string{}
	if c.Platen != nil {
		out = append(out, "platen")
	}
	if c.Feeder != nil {
		out = append(out, "feeder")
	}
	return out
}

// ColorModes lists the colour modes in the helper's API terms
// ("color", "grayscale", "bw"), across all sources.
func (c *Capabilities) ColorModes() []string {
	has := map[string]bool{}
	for _, in := range c.inputs() {
		for _, m := range in.ColorModes {
			has[ModeFamily(m)] = true
		}
	}
	out := []string{}
	for _, f := range []string{"color", "grayscale", "bw"} {
		if has[f] {
			out = append(out, f)
		}
	}
	return out
}

// Resolutions lists the resolutions (dpi) across all sources, ascending.
func (c *Capabilities) Resolutions() []int {
	out := []int{}
	for _, in := range c.inputs() {
		for _, r := range in.Resolutions {
			if !slices.Contains(out, r) {
				out = append(out, r)
			}
		}
	}
	slices.Sort(out)
	return out
}

// Formats lists the document formats (MIME types) across all sources.
func (c *Capabilities) Formats() []string {
	out := []string{}
	for _, in := range c.inputs() {
		for _, f := range in.Formats {
			if !slices.Contains(out, f) {
				out = append(out, f)
			}
		}
	}
	return out
}

// ModeFamily maps an eSCL colour mode to "color", "grayscale" or "bw".
func ModeFamily(mode string) string {
	switch {
	case strings.HasPrefix(mode, "RGB"):
		return "color"
	case strings.HasPrefix(mode, "Grayscale"):
		return "grayscale"
	case strings.HasPrefix(mode, "BlackAndWhite"):
		return "bw"
	}
	return ""
}

var (
	modePrefs = map[string][]string{
		"color":     {"RGB24", "RGB48"},
		"grayscale": {"Grayscale8", "Grayscale16"},
		"bw":        {"BlackAndWhite1"},
	}
	familyFallback = map[string][]string{
		"color":     {"color", "grayscale", "bw"},
		"grayscale": {"grayscale", "color", "bw"},
		"bw":        {"bw", "grayscale", "color"},
	}
)

// ChooseColorMode picks the eSCL colour mode for a family ("color",
// "grayscale", "bw"), falling back to the closest mode the source offers.
func ChooseColorMode(in *InputCaps, family string) string {
	prefs, ok := modePrefs[family]
	if !ok {
		family, prefs = "color", modePrefs["color"]
	}
	if in == nil || len(in.ColorModes) == 0 {
		return prefs[0]
	}
	for _, f := range familyFallback[family] {
		for _, m := range modePrefs[f] {
			if slices.Contains(in.ColorModes, m) {
				return m
			}
		}
	}
	return prefs[0]
}

// ChooseResolution picks the supported resolution closest to want
// (the higher one on a tie).
func ChooseResolution(in *InputCaps, want int) int {
	if in == nil || len(in.Resolutions) == 0 {
		return want
	}
	best := in.Resolutions[0]
	for _, r := range in.Resolutions {
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

// ChooseFormat picks the format to ask for: JPEG pages when offered (the
// helper builds the PDF itself), else the scanner's own PDF, else PNG.
func ChooseFormat(in *InputCaps) (string, bool) {
	if in == nil || len(in.Formats) == 0 {
		return "image/jpeg", true
	}
	for _, f := range []string{"image/jpeg", "application/pdf", "image/png"} {
		if slices.Contains(in.Formats, f) {
			return f, true
		}
	}
	return "", false
}

// Region returns the scan area in 1/300 inch: A4, or less when the source is
// smaller.
func Region(in *InputCaps) (width, height int) {
	width, height = A4Width, A4Height
	if in != nil {
		if in.MaxWidth > 0 {
			width = min(width, in.MaxWidth)
		}
		if in.MaxHeight > 0 {
			height = min(height, in.MaxHeight)
		}
	}
	return width, height
}
