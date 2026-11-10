package paper

import (
	"encoding/json"
	"errors"
	"slices"
	"testing"
)

func TestParse(t *testing.T) {
	ok := map[string]Size{
		``:                                      {},
		`null`:                                  {},
		`""`:                                    {},
		`"  "`:                                  {},
		`"A4"`:                                  A4,
		`"a5"`:                                  A5,
		`" A5 "`:                                A5,
		`"Letter"`:                              Letter,
		`"LETTER"`:                              Letter,
		`{"widthMm": 85.6, "heightMm": 54}`:     {W: 8560, H: 5400},
		`{"heightMm": 150, "widthMm": 100}`:     {W: 10000, H: 15000},
		`{"widthMm": 10, "heightMm": 1000}`:     {W: 1000, H: 100000},
		`{"widthMm": 148.004, "heightMm": 210}`: {W: 14800, H: 21000},
	}
	for in, want := range ok {
		got, err := Parse(json.RawMessage(in))
		if err != nil || got != want {
			t.Errorf("Parse(%s) = %+v, %v; want %+v", in, got, err, want)
		}
	}
	bad := map[string]error{
		`"A3"`:                                  ErrUnknown,
		`"Legal"`:                               ErrUnknown,
		`"A 5"`:                                 ErrUnknown,
		`5`:                                     ErrUnknown,
		`true`:                                  ErrUnknown,
		`[210,297]`:                             ErrUnknown,
		`{}`:                                    ErrBadMm,
		`{"widthMm": 100}`:                      ErrBadMm,
		`{"widthMm": 0, "heightMm": 100}`:       ErrBadMm,
		`{"widthMm": -148, "heightMm": 210}`:    ErrBadMm,
		`{"widthMm": 9.99, "heightMm": 210}`:    ErrBadMm,
		`{"widthMm": 148, "heightMm": 1000.5}`:  ErrBadMm,
		`{"widthMm": "148", "heightMm": "210"}`: ErrBadMm,
		`{"width": 148, "height": 210}`:         ErrBadMm,
		`{"widthMm": 148, "heightMm": 210, "x": 0}`: ErrBadMm,
		`{"widthMm": 148, "heightMm": null}`:        ErrBadMm,
	}
	for in, want := range bad {
		if got, err := Parse(json.RawMessage(in)); !errors.Is(err, want) {
			t.Errorf("Parse(%s) = %+v, %v; want %v", in, got, err, want)
		}
	}
}

func TestUnits(t *testing.T) {
	cases := []struct {
		s          Size
		w300, h300 int // eSCL, 1/300 inch
		dpi        int
		pw, ph     int // pixels at dpi
	}{
		{A4, 2480, 3508, 300, 2480, 3507},
		{A4, 2480, 3508, 200, 1653, 2338},
		{A5, 1748, 2480, 300, 1748, 2480},
		{A5, 1748, 2480, 600, 3496, 4960},
		{Letter, 2550, 3300, 300, 2550, 3300},
		{Letter, 2550, 3300, 600, 5100, 6600},
		{Size{W: 10000, H: 15000}, 1181, 1772, 300, 1181, 1771},
	}
	for _, c := range cases {
		if w, h := c.s.In300ths(); w != c.w300 || h != c.h300 {
			t.Errorf("%s in 1/300 inch = %d x %d, want %d x %d", c.s, w, h, c.w300, c.h300)
		}
		if w, h := c.s.Pixels(c.dpi); w != c.pw || h != c.ph {
			t.Errorf("%s at %d dpi = %d x %d, want %d x %d", c.s, c.dpi, w, h, c.pw, c.ph)
		}
	}
	if (Size{}).OrA4() != A4 || A5.OrA4() != A5 || !(Size{}).IsZero() || A5.IsZero() {
		t.Error("OrA4 / IsZero")
	}
	for s, want := range map[Size]string{A5: "A5", {}: "A4", {W: 8560, H: 5400}: "85.6 x 54 mm", {W: 10005, H: 15010}: "100.05 x 150.1 mm"} {
		if got := s.String(); got != want {
			t.Errorf("String = %q, want %q", got, want)
		}
	}
}

func TestFits(t *testing.T) {
	cases := []struct {
		maxW, maxH int // hundredths of a millimetre
		want       []string
	}{
		{0, 0, []string{"A4", "A5", "Letter"}},                                         // unknown
		{FromInches(2550, 300), FromInches(3508, 300), []string{"A4", "A5", "Letter"}}, // a usual glass, 216 x 297 mm
		{FromInches(8500, 1000), FromInches(11690, 1000), []string{"A4", "A5", "Letter"}},
		{FromInches(2551, 300), FromInches(3295, 300), []string{"A5", "Letter"}}, // a Letter glass, 279 mm long: A4 doesn't fit
		{FromInches(5826, 1000), FromInches(8267, 1000), []string{"A5"}},
		{10000, 10000, []string{}},
		{0, 25000, []string{"A5"}}, // its width unknown
	}
	for _, c := range cases {
		if got := NamesThatFit(c.maxW, c.maxH); !slices.Equal(got, c.want) {
			t.Errorf("NamesThatFit(%d, %d) = %v, want %v", c.maxW, c.maxH, got, c.want)
		}
	}
	if got := FromInches(300, 300); got != 2540 {
		t.Errorf("FromInches = %d", got)
	}
	if got := FromInches(300, 0); got != 0 {
		t.Errorf("FromInches of nothing = %d", got)
	}
}
