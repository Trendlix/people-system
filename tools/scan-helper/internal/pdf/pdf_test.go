package pdf_test

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"image/color"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"trendlix.com/scan-helper/internal/escltest"
	"trendlix.com/scan-helper/internal/pdf"
)

func mustJPEG(t *testing.T, w, h int) pdf.Image {
	t.Helper()
	img, err := pdf.ParseJPEG(escltest.JPEG(w, h, color.RGBA{200, 30, 30, 255}))
	if err != nil {
		t.Fatal(err)
	}
	return img
}

// checkStructure validates header, cross-reference table and trailer, and
// returns the file's objects by number.
func checkStructure(t *testing.T, data []byte) map[int]string {
	t.Helper()
	if !bytes.HasPrefix(data, []byte("%PDF-1.4\n")) {
		t.Fatalf("bad header: %q", data[:min(len(data), 16)])
	}
	m := regexp.MustCompile(`startxref\n(\d+)\n%%EOF\n$`).FindSubmatch(data)
	if m == nil {
		t.Fatal("no startxref / EOF marker at the end")
	}
	xref, _ := strconv.Atoi(string(m[1]))
	if !bytes.HasPrefix(data[xref:], []byte("xref\n0 ")) {
		t.Fatalf("startxref %d doesn't point at the xref table", xref)
	}
	var first, count int
	if _, err := fmt.Sscanf(string(data[xref:]), "xref\n%d %d\n", &first, &count); err != nil || first != 0 {
		t.Fatalf("bad xref subsection: %v", err)
	}
	table := data[xref:]
	table = table[bytes.IndexByte(table, '\n')+1:]
	table = table[bytes.IndexByte(table, '\n')+1:]
	if string(table[:20]) != "0000000000 65535 f \n" {
		t.Fatalf("bad free entry %q", table[:20])
	}
	objects := map[int]string{}
	for n := 1; n < count; n++ {
		entry := string(table[20*n : 20*n+20])
		if !strings.HasSuffix(entry, " 00000 n \n") {
			t.Fatalf("bad xref entry %d: %q", n, entry)
		}
		off, _ := strconv.Atoi(entry[:10])
		head := fmt.Sprintf("%d 0 obj\n", n)
		if !bytes.HasPrefix(data[off:], []byte(head)) {
			t.Fatalf("xref entry %d points at %q", n, data[off:off+12])
		}
		end := bytes.Index(data[off:], []byte("endobj"))
		objects[n] = string(data[off : off+end])
	}
	trailer := string(table[20*count:])
	if !strings.HasPrefix(trailer, "trailer\n") || !strings.Contains(trailer, fmt.Sprintf("/Size %d", count)) || !strings.Contains(trailer, "/Root 1 0 R") {
		t.Fatalf("bad trailer: %q", trailer)
	}
	return objects
}

func TestWriteStructureAndPageCount(t *testing.T) {
	images := []pdf.Image{mustJPEG(t, 600, 300), mustJPEG(t, 250, 350), mustJPEG(t, 100, 100)}
	var buf bytes.Buffer
	if err := pdf.Write(&buf, images, pdf.Options{Producer: "test (1)", Created: time.Date(2026, 10, 15, 14, 30, 0, 0, time.UTC), DefaultDPI: 300}); err != nil {
		t.Fatal(err)
	}
	objects := checkStructure(t, buf.Bytes())
	if len(objects) != 3+3*3 {
		t.Errorf("objects = %d", len(objects))
	}
	if !strings.Contains(objects[1], "/Type /Catalog") || !strings.Contains(objects[2], "/Count 3") {
		t.Errorf("catalog/pages: %q %q", objects[1], objects[2])
	}
	if !strings.Contains(objects[3], `/Producer (test \(1\))`) || !strings.Contains(objects[3], "D:20261015143000+00'00'") {
		t.Errorf("info: %q", objects[3])
	}
	// 600x300 px at 300 dpi is 2x1 inch = 144x72 pt.
	if !strings.Contains(objects[4], "/MediaBox [0 0 144 72]") {
		t.Errorf("page 1: %q", objects[4])
	}
	if !strings.Contains(objects[5], "/Filter /DCTDecode") || !strings.Contains(objects[5], "/Width 600 /Height 300") || !strings.Contains(objects[5], "/DeviceRGB") {
		t.Errorf("image 1: %q", objects[5][:min(len(objects[5]), 200)])
	}
	if got := pdf.CountPages(buf.Bytes()); got != 3 {
		t.Errorf("CountPages = %d, want 3", got)
	}
	if !pdf.IsPDF(buf.Bytes()) {
		t.Error("IsPDF = false")
	}
}

func TestParseJPEGReadsJFIFResolution(t *testing.T) {
	raw := escltest.JPEG(400, 200, color.Black)
	// Insert a JFIF APP0 segment saying 200 dpi right after SOI.
	app0 := []byte{0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01, 0x01, 0x01, 0x00, 0xC8, 0x00, 0xC8, 0x00, 0x00}
	withJFIF := append(append(append([]byte{}, raw[:2]...), app0...), raw[2:]...)
	img, err := pdf.ParseJPEG(withJFIF)
	if err != nil {
		t.Fatal(err)
	}
	if img.Width != 400 || img.Height != 200 || img.Components != 3 || img.DPIX != 200 || img.DPIY != 200 {
		t.Errorf("got %+v", img)
	}
	var buf bytes.Buffer
	if err := pdf.Write(&buf, []pdf.Image{img}, pdf.Options{DefaultDPI: 300}); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(buf.Bytes(), []byte("/MediaBox [0 0 144 72]")) {
		t.Error("page size should follow the JPEG's 200 dpi")
	}
}

func TestParseJPEGRejectsOtherData(t *testing.T) {
	for _, b := range [][]byte{nil, []byte("%PDF-1.4"), {0xFF, 0xD8, 0xFF, 0xD9}} {
		if _, err := pdf.ParseJPEG(b); err == nil {
			t.Errorf("expected an error for %q", b)
		}
	}
}

func TestCountPagesInObjectStreams(t *testing.T) {
	var z bytes.Buffer
	zw := zlib.NewWriter(&z)
	zw.Write([]byte("<</Type/Page/Parent 2 0 R>> <</Type /Page /Parent 2 0 R>> <</Type/Pages/Count 2>>"))
	zw.Close()
	doc := []byte("%PDF-1.5\n5 0 obj\n<</Type/ObjStm/N 3/First 10/Filter/FlateDecode/Length " + strconv.Itoa(z.Len()) + ">>\nstream\n")
	doc = append(doc, z.Bytes()...)
	doc = append(doc, []byte("\nendstream\nendobj\n%%EOF\n")...)
	if got := pdf.CountPages(doc); got != 2 {
		t.Errorf("CountPages = %d, want 2", got)
	}
}
