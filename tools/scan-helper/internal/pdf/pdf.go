// Package pdf writes simple PDFs made of JPEG page images, without any
// dependency: each image is embedded as-is (DCTDecode) on its own page.
package pdf

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Image is a JPEG ready to be placed on a page.
type Image struct {
	JPEG       []byte
	Width      int // pixels
	Height     int
	Components int     // 1 grey, 3 RGB, 4 CMYK
	Inverted   bool    // Adobe CMYK JPEGs store inverted values
	DPIX, DPIY float64 // from the JPEG's JFIF header; 0 when unknown or implausible
}

// IsJPEG, IsPNG and IsPDF look at a file's first bytes.
func IsJPEG(b []byte) bool { return len(b) > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF }
func IsPNG(b []byte) bool  { return bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")) }
func IsPDF(b []byte) bool {
	return bytes.HasPrefix(bytes.TrimLeft(b[:min(len(b), 1024)], "\x00\t\r\n "), []byte("%PDF-"))
}

// ParseJPEG reads a JPEG's size, colour components and resolution.
func ParseJPEG(data []byte) (Image, error) {
	if !IsJPEG(data) {
		return Image{}, errors.New("not a JPEG image")
	}
	img := Image{JPEG: data}
	var jfifUnits int
	var jfifX, jfifY int
	i := 2
	for i+4 <= len(data) {
		if data[i] != 0xFF {
			return Image{}, errors.New("damaged JPEG image")
		}
		marker := data[i+1]
		if marker == 0xFF { // fill byte
			i++
			continue
		}
		if marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			i += 2
			continue
		}
		if marker == 0xD9 || marker == 0xDA { // end of image, start of scan
			break
		}
		segLen := int(data[i+2])<<8 | int(data[i+3])
		if segLen < 2 || i+2+segLen > len(data) {
			return Image{}, errors.New("damaged JPEG image")
		}
		seg := data[i+4 : i+2+segLen]
		switch {
		case marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC:
			if len(seg) < 6 {
				return Image{}, errors.New("damaged JPEG image")
			}
			if seg[0] != 8 {
				return Image{}, fmt.Errorf("%d-bit JPEG images aren't supported", seg[0])
			}
			img.Height = int(seg[1])<<8 | int(seg[2])
			img.Width = int(seg[3])<<8 | int(seg[4])
			img.Components = int(seg[5])
		case marker == 0xE0 && len(seg) >= 12 && string(seg[:5]) == "JFIF\x00":
			jfifUnits = int(seg[7])
			jfifX = int(seg[8])<<8 | int(seg[9])
			jfifY = int(seg[10])<<8 | int(seg[11])
		case marker == 0xEE && len(seg) >= 5 && string(seg[:5]) == "Adobe":
			img.Inverted = true
		}
		i += 2 + segLen
	}
	if img.Width <= 0 || img.Height <= 0 {
		return Image{}, errors.New("the JPEG image has no size")
	}
	if img.Components != 1 && img.Components != 3 && img.Components != 4 {
		return Image{}, fmt.Errorf("JPEG images with %d colour components aren't supported", img.Components)
	}
	if img.Components != 4 {
		img.Inverted = false
	}
	img.DPIX, img.DPIY = jfifDPI(jfifUnits, jfifX), jfifDPI(jfifUnits, jfifY)
	if img.DPIX == 0 || img.DPIY == 0 {
		img.DPIX, img.DPIY = 0, 0
	}
	return img, nil
}

// jfifDPI converts a JFIF density to dpi, ignoring values that are missing
// or the usual placeholders (72 and 96) some scanners write regardless.
func jfifDPI(units, v int) float64 {
	var dpi float64
	switch units {
	case 1:
		dpi = float64(v)
	case 2:
		dpi = float64(v) * 2.54
	default:
		return 0
	}
	if dpi < 50 || dpi > 2400 || dpi == 72 || dpi == 96 {
		return 0
	}
	return dpi
}

// Options for Write.
type Options struct {
	Producer   string
	Created    time.Time
	DefaultDPI float64 // used when an image carries no usable resolution
}

type countingWriter struct {
	w   *bufio.Writer
	n   int64
	err error
}

func (c *countingWriter) Write(p []byte) (int, error) {
	if c.err != nil {
		return 0, c.err
	}
	n, err := c.w.Write(p)
	c.n += int64(n)
	c.err = err
	return n, err
}

func (c *countingWriter) printf(format string, args ...any) {
	fmt.Fprintf(c, format, args...)
}

// Write writes a PDF with one page per image. Each page is the size of the
// image at its resolution, so a 300 dpi A4 scan gives an A4 page.
func Write(w io.Writer, images []Image, opts Options) error {
	if len(images) == 0 {
		return errors.New("no pages to write")
	}
	if opts.DefaultDPI <= 0 {
		opts.DefaultDPI = 300
	}
	if opts.Created.IsZero() {
		opts.Created = time.Now()
	}
	// Objects: 1 catalog, 2 page tree, 3 info, then per page: page, image, content.
	objects := 3 + 3*len(images)
	offsets := make([]int64, objects+1)
	cw := &countingWriter{w: bufio.NewWriter(w)}
	start := func(num int) {
		offsets[num] = cw.n
		cw.printf("%d 0 obj\n", num)
	}

	cw.printf("%%PDF-1.4\n%%\xE2\xE3\xCF\xD3\n")

	start(1)
	cw.printf("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

	start(2)
	kids := make([]string, len(images))
	for i := range images {
		kids[i] = fmt.Sprintf("%d 0 R", 4+3*i)
	}
	cw.printf("<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n", strings.Join(kids, " "), len(images))

	start(3)
	cw.printf("<< /Producer %s /CreationDate %s >>\nendobj\n", pdfString(opts.Producer), pdfString(pdfDate(opts.Created)))

	for i, img := range images {
		pageObj, imageObj, contentObj := 4+3*i, 5+3*i, 6+3*i
		dpiX, dpiY := img.DPIX, img.DPIY
		if dpiX <= 0 || dpiY <= 0 {
			dpiX, dpiY = opts.DefaultDPI, opts.DefaultDPI
		}
		wPt := float64(img.Width) * 72 / dpiX
		hPt := float64(img.Height) * 72 / dpiY

		start(pageObj)
		cw.printf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources << /XObject << /Im0 %d 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> /Contents %d 0 R >>\nendobj\n",
			num(wPt), num(hPt), imageObj, contentObj)

		colorSpace, decode := "/DeviceRGB", ""
		switch img.Components {
		case 1:
			colorSpace = "/DeviceGray"
		case 4:
			colorSpace = "/DeviceCMYK"
			if img.Inverted {
				decode = " /Decode [1 0 1 0 1 0 1 0]"
			}
		}
		start(imageObj)
		cw.printf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8%s /Filter /DCTDecode /Length %d >>\nstream\n",
			img.Width, img.Height, colorSpace, decode, len(img.JPEG))
		cw.Write(img.JPEG)
		cw.printf("\nendstream\nendobj\n")

		content := fmt.Sprintf("q %s 0 0 %s 0 0 cm /Im0 Do Q", num(wPt), num(hPt))
		start(contentObj)
		cw.printf("<< /Length %d >>\nstream\n%s\nendstream\nendobj\n", len(content), content)
	}

	xref := cw.n
	cw.printf("xref\n0 %d\n", objects+1)
	cw.printf("0000000000 65535 f \n")
	for n := 1; n <= objects; n++ {
		cw.printf("%010d 00000 n \n", offsets[n])
	}
	cw.printf("trailer\n<< /Size %d /Root 1 0 R /Info 3 0 R >>\nstartxref\n%d\n%%%%EOF\n", objects+1, xref)
	if cw.err != nil {
		return cw.err
	}
	return cw.w.Flush()
}

func num(v float64) string {
	s := strconv.FormatFloat(v, 'f', 2, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "" || s == "-" {
		return "0"
	}
	return s
}

func pdfString(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `(`, `\(`, `)`, `\)`, "\r", `\r`, "\n", `\n`)
	return "(" + r.Replace(s) + ")"
}

func pdfDate(t time.Time) string {
	_, off := t.Zone()
	sign := "+"
	if off < 0 {
		sign, off = "-", -off
	}
	return fmt.Sprintf("D:%s%s%02d'%02d'", t.Format("20060102150405"), sign, off/3600, (off%3600)/60)
}

var (
	pageRE   = regexp.MustCompile(`/Type\s*/Page\b`)
	objStmRE = regexp.MustCompile(`/Type\s*/ObjStm\b`)
)

// CountPages counts the pages of a PDF, best effort: it looks for page
// objects in the file and inside compressed object streams. It returns 0 if
// it finds none.
func CountPages(data []byte) int {
	n := len(pageRE.FindAllIndex(data, -1))
	for _, loc := range objStmRE.FindAllIndex(data, -1) {
		rest := data[loc[1]:]
		s := bytes.Index(rest, []byte("stream"))
		if s < 0 {
			continue
		}
		body := rest[s+len("stream"):]
		body = bytes.TrimPrefix(body, []byte("\r"))
		body = bytes.TrimPrefix(body, []byte("\n"))
		if e := bytes.Index(body, []byte("endstream")); e >= 0 {
			body = body[:e]
		}
		zr, err := zlib.NewReader(bytes.NewReader(body))
		if err != nil {
			continue
		}
		inflated, _ := io.ReadAll(io.LimitReader(zr, 64<<20))
		zr.Close()
		n += len(pageRE.FindAllIndex(inflated, -1))
	}
	return n
}
