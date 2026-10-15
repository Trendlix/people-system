package escl

import (
	"context"
	"crypto/tls"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// Kind says what went wrong when talking to a scanner.
type Kind int

const (
	KindUnreachable Kind = iota + 1 // nothing answered at that address
	KindNotScanner                  // something answered, but not an eSCL scanner
	KindBusy                        // the scanner is busy with another job
	KindFeederEmpty                 // no paper in the document feeder
	KindTimeout                     // the scan made no progress for too long
	KindCanceled                    // the web page stopped waiting
	KindDevice                      // the scanner reported a problem
)

// Error is a scanner problem. Detail is a plain-English clause for
// KindDevice and KindNotScanner.
type Error struct {
	Kind   Kind
	Detail string
	Err    error
}

func (e *Error) Error() string {
	var s string
	switch e.Kind {
	case KindUnreachable:
		s = "scanner unreachable"
	case KindNotScanner:
		s = "not an eSCL scanner"
	case KindBusy:
		s = "scanner busy"
	case KindFeederEmpty:
		s = "document feeder empty"
	case KindTimeout:
		s = "scan timed out"
	case KindCanceled:
		s = "scan cancelled"
	default:
		s = "scanner error"
	}
	if e.Detail != "" {
		s += ": " + e.Detail
	}
	if e.Err != nil {
		s += " (" + e.Err.Error() + ")"
	}
	return s
}

func (e *Error) Unwrap() error { return e.Err }

// KindOf returns the Kind of a scanner error, or 0.
func KindOf(err error) Kind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return 0
}

// Client talks eSCL to scanners.
type Client struct {
	HTTP      *http.Client
	UserAgent string
	// PollInterval is how long to wait before asking again when the scanner
	// says the next page isn't ready yet (HTTP 503).
	PollInterval time.Duration
}

// NewClient returns a Client with an HTTP client suited to LAN scanners.
func NewClient(userAgent string) *Client {
	return &Client{HTTP: NewHTTPClient(), UserAgent: userAgent, PollInterval: time.Second}
}

// NewHTTPClient returns the HTTP client used for scanners only.
func NewHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	return &http.Client{Transport: &http.Transport{
		// Scanners are on the local network: never send this traffic through
		// a proxy configured for the internet.
		Proxy:       nil,
		DialContext: dialer.DialContext,
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialScannerTLS(ctx, dialer, network, addr)
		},
		MaxIdleConnsPerHost:   2,
		IdleConnTimeout:       30 * time.Second,
		ExpectContinueTimeout: time.Second,
	}}
}

// dialScannerTLS opens an HTTPS connection to a scanner.
//
// Network scanners that offer eSCL over HTTPS (advertised as _uscans._tcp)
// almost always use a self-signed certificate made by the device itself: it
// has no public name a real certificate could be issued for, and no operating
// system trusts it. So that HR can still use the encrypted connection, we skip
// certificate verification, but only when the connection really goes to a
// private, link-local or loopback address on this network (checked on the
// connected socket, not on a name). Anything else keeps full verification.
// The same LAN-only connections also accept the older TLS versions and
// ciphers that scanner firmware often still uses. This applies to this
// scanner client only; nothing else in the helper makes outgoing requests.
func dialScannerTLS(ctx context.Context, dialer *net.Dialer, network, addr string) (net.Conn, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	raw, err := dialer.DialContext(ctx, network, addr)
	if err != nil {
		return nil, err
	}
	cfg := &tls.Config{ServerName: host}
	if tcp, ok := raw.RemoteAddr().(*net.TCPAddr); ok && IsLANAddress(tcp.IP) {
		cfg.InsecureSkipVerify = true // see the comment above: LAN scanners only
		cfg.MinVersion = tls.VersionTLS10
		cfg.CipherSuites = lanCipherSuites()
	}
	conn := tls.Client(raw, cfg)
	if err := conn.HandshakeContext(ctx); err != nil {
		raw.Close()
		return nil, err
	}
	return conn, nil
}

// IsLANAddress reports whether ip is a private, link-local or loopback
// address, i.e. a device on this local network or this computer.
func IsLANAddress(ip net.IP) bool {
	return ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast())
}

func lanCipherSuites() []uint16 {
	var ids []uint16
	for _, s := range tls.CipherSuites() {
		ids = append(ids, s.ID)
	}
	// RSA key exchange suites, left out of Go's defaults but common in
	// older scanner firmware.
	return append(ids,
		tls.TLS_RSA_WITH_AES_128_GCM_SHA256,
		tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
		tls.TLS_RSA_WITH_AES_128_CBC_SHA,
		tls.TLS_RSA_WITH_AES_256_CBC_SHA,
	)
}

func (c *Client) request(ctx context.Context, method, url string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	if c.UserAgent != "" {
		req.Header.Set("User-Agent", c.UserAgent)
	}
	if body != nil {
		req.Header.Set("Content-Type", "text/xml")
	}
	return c.HTTP.Do(req)
}

func drainClose(body io.ReadCloser) {
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 64<<10))
	body.Close()
}

// Capabilities fetches and parses {base}/ScannerCapabilities.
func (c *Client) Capabilities(ctx context.Context, base string) (*Capabilities, error) {
	resp, err := c.request(ctx, http.MethodGet, base+"/ScannerCapabilities", nil)
	if err != nil {
		return nil, &Error{Kind: KindUnreachable, Err: err}
	}
	defer drainClose(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, &Error{Kind: KindNotScanner, Detail: fmt.Sprintf("it answered HTTP %d", resp.StatusCode)}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, &Error{Kind: KindUnreachable, Err: err}
	}
	caps, err := ParseCapabilities(data)
	if err != nil {
		return nil, &Error{Kind: KindNotScanner, Detail: err.Error()}
	}
	return caps, nil
}

// Status is the part of eSCL ScannerStatus the helper uses.
type Status struct {
	State    string // Idle, Processing, Testing, Stopped, Down
	AdfState string // ScannerAdfLoaded, ScannerAdfEmpty, ScannerAdfJam, ...
}

// FeederEmpty reports whether the scanner says its feeder has no paper.
func (s *Status) FeederEmpty() bool { return strings.EqualFold(s.AdfState, "ScannerAdfEmpty") }

// FeederJammed reports whether the scanner says paper is stuck in the feeder.
func (s *Status) FeederJammed() bool {
	return strings.EqualFold(s.AdfState, "ScannerAdfJam") || strings.EqualFold(s.AdfState, "ScannerAdfMispick")
}

// Status fetches {base}/ScannerStatus.
func (c *Client) Status(ctx context.Context, base string) (*Status, error) {
	resp, err := c.request(ctx, http.MethodGet, base+"/ScannerStatus", nil)
	if err != nil {
		return nil, err
	}
	defer drainClose(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ScannerStatus answered HTTP %d", resp.StatusCode)
	}
	var x struct {
		State    string `xml:"State"`
		AdfState string `xml:"AdfState"`
	}
	dec := xml.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	dec.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil }
	if err := dec.Decode(&x); err != nil {
		return nil, err
	}
	return &Status{State: strings.TrimSpace(x.State), AdfState: strings.TrimSpace(x.AdfState)}, nil
}
