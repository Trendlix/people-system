// Package paper is the area a scan covers: A4, A5, Letter, or a width and
// height in millimetres, measured from the scanner's origin corner (the corner
// of the glass the scanner marks, where the document is laid).
//
// Sizes are kept in hundredths of a millimetre, so that the named ones are
// exact and turning them into the scanner's units is plain integer arithmetic.
package paper

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

// Size is an area to scan, in hundredths of a millimetre. The zero Size means
// no size was asked: A4, as before sizes could be asked.
type Size struct {
	Name string // "A4", "A5", "Letter"; "" for a size given in millimetres
	W, H int    // hundredths of a millimetre
}

// The sizes known by name, portrait.
var (
	A4     = Size{Name: "A4", W: 21000, H: 29700}
	A5     = Size{Name: "A5", W: 14800, H: 21000}
	Letter = Size{Name: "Letter", W: 21590, H: 27940} // 8.5 x 11 inches
)

// Named lists the sizes known by name, in the order the API gives them.
var Named = []Size{A4, A5, Letter}

// The smallest and largest width or height a size given in millimetres may
// have. A size larger than the glass is reduced to the glass when it is
// scanned.
const (
	MinMm = 10
	MaxMm = 1000
)

// FitSlack is how much (hundredths of a millimetre) a named size may exceed
// the glass and still be said to fit it: scanners give their glass rounded,
// and the scan is reduced to the glass anyway.
const FitSlack = 200

// What Parse says of a size it can't use.
var (
	ErrUnknown = errors.New("not a size the helper knows")
	ErrBadMm   = errors.New("not a width and height in millimetres within the limits")
)

// IsZero reports whether no size was asked.
func (s Size) IsZero() bool { return s.W == 0 && s.H == 0 }

// OrA4 is the size to scan: s, or A4 when none was asked.
func (s Size) OrA4() Size {
	if s.IsZero() {
		return A4
	}
	return s
}

// String names the size: A5, or 85.6 x 54 mm.
func (s Size) String() string {
	if s.Name != "" {
		return s.Name
	}
	if s.IsZero() {
		return "A4"
	}
	return mm(s.W) + " x " + mm(s.H) + " mm"
}

func mm(h int) string {
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%d.%02d", h/100, h%100), "0"), ".")
}

// Parse reads the "size" of a scan request: absent or null (no size asked),
// a name ("A4", "A5", "Letter", in any case), or
// { "widthMm": n, "heightMm": n }.
func Parse(raw json.RawMessage) (Size, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return Size{}, nil
	}
	switch raw[0] {
	case '"':
		var name string
		if err := json.Unmarshal(raw, &name); err != nil {
			return Size{}, ErrUnknown
		}
		name = strings.TrimSpace(name)
		if name == "" {
			return Size{}, nil
		}
		for _, s := range Named {
			if strings.EqualFold(name, s.Name) {
				return s, nil
			}
		}
		return Size{}, ErrUnknown
	case '{':
		var body struct {
			WidthMm  *float64 `json:"widthMm"`
			HeightMm *float64 `json:"heightMm"`
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil || body.WidthMm == nil || body.HeightMm == nil {
			return Size{}, ErrBadMm
		}
		w, wok := hundredths(*body.WidthMm)
		h, hok := hundredths(*body.HeightMm)
		if !wok || !hok {
			return Size{}, ErrBadMm
		}
		return Size{W: w, H: h}, nil
	}
	return Size{}, ErrUnknown
}

func hundredths(v float64) (int, bool) {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < MinMm || v > MaxMm {
		return 0, false
	}
	return int(math.Round(v * 100)), true
}

// In300ths is the size in 1/300 inch (eSCL's ThreeHundredthsOfInches),
// rounded to the nearest: A4 is 2480 x 3508, A5 1748 x 2480, Letter
// 2550 x 3300.
func (s Size) In300ths() (w, h int) {
	return (s.W*300 + 1270) / 2540, (s.H*300 + 1270) / 2540
}

// Pixels is the size in pixels at dpi, never more than the size itself: A5
// is 1748 x 2480 at 300 dpi and 3496 x 4960 at 600.
func (s Size) Pixels(dpi int) (w, h int) {
	return s.W * dpi / 2540, s.H * dpi / 2540
}

// FromInches turns a length in 1/perInch inch into hundredths of a
// millimetre.
func FromInches(v, perInch int) int {
	if perInch <= 0 {
		return 0
	}
	return v * 2540 / perInch
}

// Fits reports whether s fits an area of maxW x maxH hundredths of a
// millimetre, within FitSlack. An unknown side (0) holds anything.
func (s Size) Fits(maxW, maxH int) bool {
	return (maxW <= 0 || s.W <= maxW+FitSlack) && (maxH <= 0 || s.H <= maxH+FitSlack)
}

// NamesThatFit lists the names of the named sizes that fit an area of
// maxW x maxH hundredths of a millimetre (all of them when it is unknown).
func NamesThatFit(maxW, maxH int) []string {
	out := []string{}
	for _, s := range Named {
		if s.Fits(maxW, maxH) {
			out = append(out, s.Name)
		}
	}
	return out
}
