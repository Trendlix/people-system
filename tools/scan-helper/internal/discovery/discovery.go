// Package discovery finds eSCL (AirScan) scanners on the local network with
// mDNS / Bonjour: services _uscan._tcp (HTTP) and _uscans._tcp (HTTPS).
package discovery

import (
	"context"
	"io"
	"log"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hashicorp/mdns"
)

// mDNS service types for eSCL.
const (
	ServicePlain  = "_uscan._tcp"
	ServiceSecure = "_uscans._tcp"
)

// Service is one advertised eSCL scanner endpoint.
type Service struct {
	Instance string // service instance name, e.g. "HP LaserJet MFP M428fdw (9F1234)"
	Secure   bool   // advertised as _uscans (HTTPS)
	Host     string // target host name, e.g. "NPI9F1234.local"
	IPv4     net.IP
	IPv6     net.IP
	Port     int
	TXT      map[string]string // TXT record, keys lower-cased
}

// Model is the scanner's model name from the TXT record (ty).
func (s Service) Model() string { return strings.TrimSpace(s.TXT["ty"]) }

// BaseURL is the eSCL root, e.g. http://192.168.1.23/eSCL.
func (s Service) BaseURL() string {
	scheme, defPort := "http", 80
	if s.Secure {
		scheme, defPort = "https", 443
	}
	var host string
	switch {
	case s.IPv4 != nil:
		host = s.IPv4.String()
	case s.Host != "":
		host = s.Host
	case s.IPv6 != nil:
		host = s.IPv6.String()
	}
	hostport := host
	if s.Port != 0 && s.Port != defPort {
		hostport = net.JoinHostPort(host, strconv.Itoa(s.Port))
	} else if strings.Contains(host, ":") {
		hostport = "[" + host + "]"
	}
	rs, ok := s.TXT["rs"]
	if !ok {
		rs = "eSCL"
	}
	u := scheme + "://" + hostport
	if rs = strings.Trim(strings.TrimSpace(rs), "/"); rs != "" {
		u += "/" + rs
	}
	return u
}

// Key identifies the device behind a service, so that the HTTP and HTTPS
// advertisements of one scanner can be merged.
func (s Service) Key() string {
	if u := strings.TrimSpace(s.TXT["uuid"]); u != "" {
		return "uuid:" + strings.ToLower(strings.Trim(u, "{}"))
	}
	return "name:" + strings.ToLower(s.Instance)
}

// Browser finds scanners.
type Browser interface {
	Browse(ctx context.Context, window time.Duration) ([]Service, error)
}

// MDNS browses with multicast DNS on every suitable network interface.
type MDNS struct{}

// Browse listens for scanner advertisements for the given window.
func (MDNS) Browse(ctx context.Context, window time.Duration) ([]Service, error) {
	ifaces := multicastInterfaces()
	if len(ifaces) == 0 {
		ifaces = []*net.Interface{nil} // let the system pick
	}
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		found    = map[string]Service{}
		firstErr error
		ok       int
	)
	for _, svc := range []struct {
		name   string
		secure bool
	}{{ServicePlain, false}, {ServiceSecure, true}} {
		for _, ifi := range ifaces {
			wg.Add(1)
			go func() {
				defer wg.Done()
				entries, err := query(ctx, svc.name, ifi, window)
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					if firstErr == nil {
						firstErr = err
					}
					return
				}
				ok++
				for _, e := range entries {
					s, good := FromEntry(e, svc.name, svc.secure)
					if !good {
						continue
					}
					k := strings.ToLower(e.Name)
					if old, exists := found[k]; exists && old.IPv4 != nil && s.IPv4 == nil {
						continue
					}
					found[k] = s
				}
			}()
		}
	}
	wg.Wait()
	if ok == 0 && firstErr != nil {
		return nil, firstErr
	}
	out := make([]Service, 0, len(found))
	for _, s := range found {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].BaseURL() < out[j].BaseURL() })
	return out, nil
}

func query(ctx context.Context, service string, ifi *net.Interface, window time.Duration) ([]*mdns.ServiceEntry, error) {
	ch := make(chan *mdns.ServiceEntry, 256)
	var got []*mdns.ServiceEntry
	done := make(chan struct{})
	go func() {
		// Only keep the pointers here: the library may still fill in an
		// entry while the query runs, so fields are read after it returns.
		for e := range ch {
			got = append(got, e)
		}
		close(done)
	}()
	err := mdns.QueryContext(ctx, &mdns.QueryParam{
		Service:   service,
		Domain:    "local",
		Timeout:   window,
		Interface: ifi,
		Entries:   ch,
		// Scanners answer over IPv4 everywhere; skipping IPv6 avoids failures
		// on interfaces without it.
		DisableIPv6: true,
		Logger:      log.New(io.Discard, "", 0),
	})
	close(ch)
	<-done
	return got, err
}

// FromEntry turns an mDNS answer into a Service, if it is one of ours.
func FromEntry(e *mdns.ServiceEntry, service string, secure bool) (Service, bool) {
	if e == nil {
		return Service{}, false
	}
	suffix := "." + service + ".local."
	name := e.Name
	if !strings.HasSuffix(strings.ToLower(name), suffix) || len(name) <= len(suffix) {
		return Service{}, false
	}
	if e.Port == 0 || (e.AddrV4 == nil && e.AddrV6 == nil && e.Host == "") {
		return Service{}, false
	}
	s := Service{
		Instance: UnescapeLabel(name[:len(name)-len(suffix)]),
		Secure:   secure,
		Host:     strings.TrimSuffix(e.Host, "."),
		Port:     e.Port,
		TXT:      ParseTXT(e.InfoFields),
	}
	if v4 := e.AddrV4.To4(); v4 != nil {
		s.IPv4 = v4
	}
	if e.AddrV6 != nil && e.AddrV6.To4() == nil && !e.AddrV6.IsLinkLocalUnicast() {
		s.IPv6 = e.AddrV6
	}
	return s, true
}

// ParseTXT reads key=value TXT strings; keys are lower-cased and only the
// first occurrence of a key counts (RFC 6763).
func ParseTXT(fields []string) map[string]string {
	m := map[string]string{}
	for _, f := range fields {
		k, v, _ := strings.Cut(f, "=")
		k = strings.ToLower(strings.TrimSpace(k))
		if k == "" {
			continue
		}
		if _, dup := m[k]; !dup {
			m[k] = v
		}
	}
	return m
}

// UnescapeLabel undoes DNS presentation escapes (\. \  \032).
func UnescapeLabel(s string) string {
	b := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '\\' && i+1 < len(s) {
			if i+3 < len(s) && isDigit(s[i+1]) && isDigit(s[i+2]) && isDigit(s[i+3]) {
				if v := int(s[i+1]-'0')*100 + int(s[i+2]-'0')*10 + int(s[i+3]-'0'); v < 256 {
					b = append(b, byte(v))
					i += 3
					continue
				}
			}
			b = append(b, s[i+1])
			i++
			continue
		}
		b = append(b, c)
	}
	return string(b)
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// multicastInterfaces lists the interfaces worth asking on: up, multicast,
// not loopback or VPN tunnels, with an IPv4 address.
func multicastInterfaces() []*net.Interface {
	ifs, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []*net.Interface
	for i := range ifs {
		ifi := &ifs[i]
		f := ifi.Flags
		if f&net.FlagUp == 0 || f&net.FlagMulticast == 0 || f&net.FlagLoopback != 0 || f&net.FlagPointToPoint != 0 {
			continue
		}
		addrs, err := ifi.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil {
				out = append(out, ifi)
				break
			}
		}
		if len(out) == 8 {
			break
		}
	}
	return out
}
