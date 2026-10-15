package escl

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Limits that keep a misbehaving scanner from filling the memory.
const (
	MaxDocumentSize = 200 << 20 // one page or PDF
	MaxPages        = 300
)

// ScanSettings is one eSCL scan request.
type ScanSettings struct {
	Version    string // eSCL version to declare, e.g. "2.63"
	Source     string // SourcePlaten or SourceFeeder
	Duplex     bool   // both sides (feeder only)
	ColorMode  string // RGB24, Grayscale8, BlackAndWhite1
	Resolution int    // dpi, both directions
	Format     string // MIME type to ask for
	Width      int    // scan area, 1/300 inch
	Height     int
}

// XML renders the eSCL ScanSettings document.
func (s ScanSettings) XML() []byte {
	version := s.Version
	if version == "" {
		version = "2.0"
	}
	e := html.EscapeString
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">` + "\n")
	fmt.Fprintf(&b, "  <pwg:Version>%s</pwg:Version>\n", e(version))
	b.WriteString("  <scan:Intent>Document</scan:Intent>\n")
	b.WriteString("  <pwg:ScanRegions>\n    <pwg:ScanRegion>\n")
	fmt.Fprintf(&b, "      <pwg:Height>%d</pwg:Height>\n", s.Height)
	b.WriteString("      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>\n")
	fmt.Fprintf(&b, "      <pwg:Width>%d</pwg:Width>\n", s.Width)
	b.WriteString("      <pwg:XOffset>0</pwg:XOffset>\n      <pwg:YOffset>0</pwg:YOffset>\n")
	b.WriteString("    </pwg:ScanRegion>\n  </pwg:ScanRegions>\n")
	// Older scanners read pwg:DocumentFormat, newer ones scan:DocumentFormatExt.
	fmt.Fprintf(&b, "  <pwg:DocumentFormat>%s</pwg:DocumentFormat>\n", e(s.Format))
	fmt.Fprintf(&b, "  <scan:DocumentFormatExt>%s</scan:DocumentFormatExt>\n", e(s.Format))
	fmt.Fprintf(&b, "  <pwg:InputSource>%s</pwg:InputSource>\n", e(s.Source))
	fmt.Fprintf(&b, "  <scan:XResolution>%d</scan:XResolution>\n", s.Resolution)
	fmt.Fprintf(&b, "  <scan:YResolution>%d</scan:YResolution>\n", s.Resolution)
	fmt.Fprintf(&b, "  <scan:ColorMode>%s</scan:ColorMode>\n", e(s.ColorMode))
	if s.Source == SourceFeeder {
		fmt.Fprintf(&b, "  <scan:Duplex>%t</scan:Duplex>\n", s.Duplex)
	}
	b.WriteString("</scan:ScanSettings>\n")
	return []byte(b.String())
}

// Document is one file the scanner sent: a page image, or a PDF.
type Document struct {
	ContentType string
	Data        []byte
}

// Scan runs a scan job on the scanner at base and returns what it sent.
//
// The platen gives one document; the feeder is read until the scanner says
// there are no more. idle limits how long the scanner may go without
// delivering a page; the timer restarts with each page.
func (c *Client) Scan(parent context.Context, base string, s ScanSettings, idle time.Duration) (docs []Document, err error) {
	feeder := s.Source == SourceFeeder
	if feeder && c.feederEmpty(parent, base) {
		return nil, &Error{Kind: KindFeederEmpty}
	}

	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	var timedOut atomic.Bool
	timer := time.AfterFunc(idle, func() { timedOut.Store(true); cancel() })
	defer timer.Stop()

	transportErr := func(e error) error {
		var se *Error
		switch {
		case errors.As(e, &se):
			return se
		case timedOut.Load():
			return &Error{Kind: KindTimeout, Err: e}
		case parent.Err() != nil:
			return &Error{Kind: KindCanceled, Err: e}
		}
		return &Error{Kind: KindUnreachable, Err: e}
	}

	job, err := c.createJob(ctx, base, s)
	if err != nil {
		var se *Error
		if errors.As(err, &se) {
			// Some scanners answer "busy" or a plain error when the feeder is
			// empty; their status says which.
			if feeder && (se.Kind == KindBusy || se.Kind == KindDevice) && c.feederEmpty(parent, base) {
				return nil, &Error{Kind: KindFeederEmpty}
			}
			return nil, se
		}
		return nil, transportErr(err)
	}
	defer func() {
		if err != nil {
			c.cancelJob(job)
		}
	}()

	for {
		doc, status, wait, rerr := c.nextDocument(ctx, job)
		if rerr != nil {
			return nil, transportErr(rerr)
		}
		switch {
		case status == http.StatusOK:
			docs = append(docs, doc)
			timer.Reset(idle)
			if !feeder {
				return docs, nil
			}
			if len(docs) >= MaxPages {
				c.cancelJob(job)
				return docs, nil
			}
		case status == http.StatusNotFound:
			if len(docs) > 0 {
				return docs, nil
			}
			if feeder {
				if st := c.quickStatus(parent, base); st != nil && st.FeederJammed() {
					return nil, &Error{Kind: KindDevice, Detail: "paper is stuck in the document feeder"}
				}
				return nil, &Error{Kind: KindFeederEmpty}
			}
			return nil, &Error{Kind: KindDevice, Detail: "it finished without sending a page"}
		case status == http.StatusServiceUnavailable:
			// The page isn't ready yet.
			if wait <= 0 {
				wait = c.PollInterval
			}
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return nil, transportErr(ctx.Err())
			}
		default:
			if feeder && len(docs) == 0 && c.feederEmpty(parent, base) {
				return nil, &Error{Kind: KindFeederEmpty}
			}
			if feeder && len(docs) > 0 && status == http.StatusConflict {
				// The feeder ran out between pages.
				return docs, nil
			}
			return nil, &Error{Kind: KindDevice, Detail: fmt.Sprintf("the scan stopped (HTTP %d)", status)}
		}
	}
}

func (c *Client) quickStatus(parent context.Context, base string) *Status {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 3*time.Second)
	defer cancel()
	st, err := c.Status(ctx, base)
	if err != nil {
		return nil
	}
	return st
}

func (c *Client) feederEmpty(parent context.Context, base string) bool {
	st := c.quickStatus(parent, base)
	return st != nil && st.FeederEmpty()
}

func (c *Client) createJob(ctx context.Context, base string, s ScanSettings) (string, error) {
	resp, err := c.request(ctx, http.MethodPost, base+"/ScanJobs", strings.NewReader(string(s.XML())))
	if err != nil {
		return "", err
	}
	defer drainClose(resp.Body)
	switch resp.StatusCode {
	case http.StatusCreated, http.StatusOK:
		loc := resp.Header.Get("Location")
		if strings.TrimSpace(loc) == "" {
			return "", &Error{Kind: KindDevice, Detail: "it accepted the scan but didn't say where to collect it"}
		}
		job, err := JobURL(base, loc)
		if err != nil {
			return "", &Error{Kind: KindDevice, Detail: "it gave an unreadable job address", Err: err}
		}
		return job, nil
	case http.StatusServiceUnavailable, http.StatusConflict:
		return "", &Error{Kind: KindBusy, Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	case http.StatusBadRequest, http.StatusUnsupportedMediaType, http.StatusUnprocessableEntity:
		return "", &Error{Kind: KindDevice, Detail: fmt.Sprintf("it didn't accept the scan settings (HTTP %d)", resp.StatusCode)}
	default:
		return "", &Error{Kind: KindDevice, Detail: fmt.Sprintf("it refused the scan (HTTP %d)", resp.StatusCode)}
	}
}

// JobURL turns the Location of a new scan job into the URL to read pages from.
// Relative locations are resolved against base. Some scanners put a wrong
// host (localhost, an internal name) in the Location, so the scheme and host
// of base are always kept.
func JobURL(base, location string) (string, error) {
	b, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	loc, err := url.Parse(strings.TrimSpace(location))
	if err != nil {
		return "", err
	}
	dir := *b
	dir.Path = strings.TrimRight(b.Path, "/") + "/"
	dir.RawPath = ""
	u := dir.ResolveReference(loc)
	u.Scheme, u.Host, u.User = b.Scheme, b.Host, nil
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/"), nil
}

func (c *Client) nextDocument(ctx context.Context, job string) (Document, int, time.Duration, error) {
	resp, err := c.request(ctx, http.MethodGet, job+"/NextDocument", nil)
	if err != nil {
		return Document{}, 0, 0, err
	}
	defer drainClose(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return Document{}, resp.StatusCode, retryAfter(resp), nil
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, MaxDocumentSize+1))
	if err != nil {
		return Document{}, 0, 0, err
	}
	if len(data) > MaxDocumentSize {
		return Document{}, 0, 0, &Error{Kind: KindDevice, Detail: "it sent a page that is too large"}
	}
	if len(data) == 0 {
		return Document{}, 0, 0, &Error{Kind: KindDevice, Detail: "it sent an empty page"}
	}
	return Document{ContentType: resp.Header.Get("Content-Type"), Data: data}, http.StatusOK, 0, nil
}

func retryAfter(resp *http.Response) time.Duration {
	if n, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil && n > 0 {
		return min(time.Duration(n)*time.Second, 5*time.Second)
	}
	return 0
}

// cancelJob asks the scanner to drop a job (best effort).
func (c *Client) cancelJob(job string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resp, err := c.request(ctx, http.MethodDelete, job, nil)
	if err == nil {
		drainClose(resp.Body)
	}
}
