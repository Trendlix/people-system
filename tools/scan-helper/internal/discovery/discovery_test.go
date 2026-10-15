package discovery

import (
	"net"
	"testing"

	"github.com/hashicorp/mdns"
)

func TestFromEntry(t *testing.T) {
	e := &mdns.ServiceEntry{
		Name:   `HP\ LaserJet\ MFP\ M428fdw\ \(9F1234\)._uscan._tcp.local.`,
		Host:   "NPI9F1234.local.",
		AddrV4: net.ParseIP("192.168.1.23"),
		Port:   80,
		InfoFields: []string{
			"txtvers=1", "ty=HP LaserJet MFP M428fdw", "rs=eSCL", "pdl=application/pdf,image/jpeg",
			"cs=color,grayscale,binary", "is=platen,adf", "duplex=T", "UUID=564e4333-4c30-3846-3434-a0481c9f1234", "ty=ignored",
		},
	}
	s, ok := FromEntry(e, ServicePlain, false)
	if !ok {
		t.Fatal("entry rejected")
	}
	if s.Instance != "HP LaserJet MFP M428fdw (9F1234)" {
		t.Errorf("instance = %q", s.Instance)
	}
	if s.Model() != "HP LaserJet MFP M428fdw" {
		t.Errorf("model = %q", s.Model())
	}
	if got := s.BaseURL(); got != "http://192.168.1.23/eSCL" {
		t.Errorf("url = %q", got)
	}
	if s.Key() != "uuid:564e4333-4c30-3846-3434-a0481c9f1234" {
		t.Errorf("key = %q", s.Key())
	}
	if s.Host != "NPI9F1234.local" {
		t.Errorf("host = %q", s.Host)
	}
}

func TestFromEntryRejectsOtherServices(t *testing.T) {
	e := &mdns.ServiceEntry{Name: "Printer._ipp._tcp.local.", AddrV4: net.ParseIP("192.168.1.23"), Port: 631}
	if _, ok := FromEntry(e, ServicePlain, false); ok {
		t.Error("an IPP entry was accepted as a scanner")
	}
	e = &mdns.ServiceEntry{Name: "Scanner._uscan._tcp.local.", AddrV4: net.ParseIP("192.168.1.23")}
	if _, ok := FromEntry(e, ServicePlain, false); ok {
		t.Error("an entry without a port was accepted")
	}
}

func TestBaseURL(t *testing.T) {
	ip := net.ParseIP("192.168.1.23").To4()
	cases := []struct {
		s    Service
		want string
	}{
		{Service{Secure: true, IPv4: ip, Port: 443, TXT: map[string]string{"rs": "eSCL"}}, "https://192.168.1.23/eSCL"},
		{Service{Secure: true, IPv4: ip, Port: 8443, TXT: map[string]string{"rs": "/eSCL/"}}, "https://192.168.1.23:8443/eSCL"},
		{Service{IPv4: ip, Port: 8080, TXT: map[string]string{"rs": ""}}, "http://192.168.1.23:8080"},
		{Service{IPv4: ip, Port: 80, TXT: map[string]string{}}, "http://192.168.1.23/eSCL"},
		{Service{Host: "scanner.local", Port: 80, TXT: map[string]string{"rs": "escl"}}, "http://scanner.local/escl"},
	}
	for _, c := range cases {
		if got := c.s.BaseURL(); got != c.want {
			t.Errorf("BaseURL(%+v) = %q, want %q", c.s, got, c.want)
		}
	}
}

func TestUnescapeLabel(t *testing.T) {
	for in, want := range map[string]string{
		`Brother\032MFC-L2750DW`: "Brother MFC-L2750DW",
		`A\.B\\C`:                `A.B\C`,
		`Caf\195\169`:            "Café",
		`plain`:                  "plain",
	} {
		if got := UnescapeLabel(in); got != want {
			t.Errorf("UnescapeLabel(%q) = %q, want %q", in, got, want)
		}
	}
}
