// Package escltest is a fake eSCL network scanner for tests.
package escltest

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Scanner is a fake eSCL scanner. Set the fields before Start.
type Scanner struct {
	Capabilities string        // ScannerCapabilities XML (default HPCapabilities)
	FeederPages  int           // pages a feeder job gives; a platen job gives 1
	JobStatus    int           // if set, POST ScanJobs answers this status
	AdfEmpty     bool          // ScannerStatus says the feeder is empty
	PageDelay    time.Duration // delay before each NextDocument answer
	PageType     string        // Content-Type of pages (default image/jpeg)
	Page         func(n int) []byte
	LocationHost string // host put in the Location header (mimics scanners that report a wrong one)

	mu       sync.Mutex
	settings []string
	deleted  []string
	served   map[string]int
	feeder   map[string]bool
	jobs     int
	srv      *httptest.Server
}

// Start starts the fake scanner, over HTTPS (self-signed) when tls is true.
func (f *Scanner) Start(tls bool) *Scanner {
	if f.Capabilities == "" {
		f.Capabilities = HPCapabilities
	}
	if f.PageType == "" {
		f.PageType = "image/jpeg"
	}
	if f.Page == nil {
		f.Page = func(n int) []byte { return JPEG(170, 240, color.RGBA{uint8(40 * n), 120, 200, 255}) }
	}
	f.served = map[string]int{}
	f.feeder = map[string]bool{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /eSCL/ScannerCapabilities", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/xml")
		io.WriteString(w, f.Capabilities)
	})
	mux.HandleFunc("GET /eSCL/ScannerStatus", func(w http.ResponseWriter, r *http.Request) {
		adf := "ScannerAdfLoaded"
		if f.AdfEmpty {
			adf = "ScannerAdfEmpty"
		}
		w.Header().Set("Content-Type", "text/xml")
		fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerStatus xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <pwg:State>Idle</pwg:State>
  <scan:AdfState>%s</scan:AdfState>
</scan:ScannerStatus>`, adf)
	})
	mux.HandleFunc("POST /eSCL/ScanJobs", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.settings = append(f.settings, string(body))
		status := f.JobStatus
		f.jobs++
		id := "job-" + strconv.Itoa(f.jobs)
		f.feeder[id] = strings.Contains(string(body), "<pwg:InputSource>Feeder</pwg:InputSource>")
		f.mu.Unlock()
		if status != 0 {
			w.WriteHeader(status)
			return
		}
		host := r.Host
		if f.LocationHost != "" {
			host = f.LocationHost
		}
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		w.Header().Set("Location", (&url.URL{Scheme: scheme, Host: host, Path: "/eSCL/ScanJobs/" + id}).String())
		w.WriteHeader(http.StatusCreated)
	})
	mux.HandleFunc("GET /eSCL/ScanJobs/{id}/NextDocument", func(w http.ResponseWriter, r *http.Request) {
		if f.PageDelay > 0 {
			select {
			case <-time.After(f.PageDelay):
			case <-r.Context().Done():
				return
			}
		}
		id := r.PathValue("id")
		f.mu.Lock()
		n := f.served[id]
		pages := 1
		if f.feeder[id] {
			pages = f.FeederPages
		}
		if n < pages {
			f.served[id] = n + 1
		}
		f.mu.Unlock()
		if n >= pages {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", f.PageType)
		w.Write(f.Page(n + 1))
	})
	mux.HandleFunc("DELETE /eSCL/ScanJobs/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.deleted = append(f.deleted, r.PathValue("id"))
		f.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	})
	if tls {
		f.srv = httptest.NewTLSServer(mux)
	} else {
		f.srv = httptest.NewServer(mux)
	}
	return f
}

// Close stops the fake scanner.
func (f *Scanner) Close() { f.srv.Close() }

// URL is the server root, e.g. http://127.0.0.1:54321.
func (f *Scanner) URL() string { return f.srv.URL }

// BaseURL is the eSCL root, e.g. http://127.0.0.1:54321/eSCL.
func (f *Scanner) BaseURL() string { return f.srv.URL + "/eSCL" }

// HostPort is the scanner's address, e.g. 127.0.0.1:54321.
func (f *Scanner) HostPort() string {
	return strings.TrimPrefix(strings.TrimPrefix(f.srv.URL, "http://"), "https://")
}

// Settings returns the ScanSettings documents received.
func (f *Scanner) Settings() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.settings...)
}

// Deleted returns the ids of the jobs that were cancelled.
func (f *Scanner) Deleted() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.deleted...)
}

// JPEG makes a small JPEG image.
func JPEG(w, h int, c color.Color) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			if (x/10+y/10)%2 == 0 {
				img.Set(x, y, c)
			} else {
				img.Set(x, y, color.White)
			}
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 80}); err != nil {
		panic(err)
	}
	return b.Bytes()
}

// HPCapabilities are real-looking capabilities of a multifunction printer
// with a glass and a duplex document feeder.
const HPCapabilities = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerCapabilities xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm" xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.hp.com/imaging/escl/2011/05/03 ../../schemas/eSCL.xsd">
	<pwg:Version>2.63</pwg:Version>
	<pwg:MakeAndModel>HP LaserJet MFP M428fdw</pwg:MakeAndModel>
	<pwg:SerialNumber>PHBLM12345</pwg:SerialNumber>
	<scan:UUID>564e4333-4c30-3846-3434-a0481c9f1234</scan:UUID>
	<scan:AdminURI>http://NPI9F1234.local./#hId-pgDevInfo</scan:AdminURI>
	<scan:IconURI>http://NPI9F1234.local./ipp/images/printer.png</scan:IconURI>
	<scan:Platen>
		<scan:PlatenInputCaps>
			<scan:MinWidth>8</scan:MinWidth>
			<scan:MaxWidth>2550</scan:MaxWidth>
			<scan:MinHeight>8</scan:MinHeight>
			<scan:MaxHeight>3508</scan:MaxHeight>
			<scan:MaxScanRegions>1</scan:MaxScanRegions>
			<scan:SettingProfiles>
				<scan:SettingProfile>
					<scan:ColorModes>
						<scan:ColorMode>BlackAndWhite1</scan:ColorMode>
						<scan:ColorMode>Grayscale8</scan:ColorMode>
						<scan:ColorMode>RGB24</scan:ColorMode>
					</scan:ColorModes>
					<scan:ContentTypes>
						<pwg:ContentType>Photo</pwg:ContentType>
						<pwg:ContentType>Text</pwg:ContentType>
						<pwg:ContentType>TextAndPhoto</pwg:ContentType>
					</scan:ContentTypes>
					<scan:DocumentFormats>
						<pwg:DocumentFormat>application/octet-stream</pwg:DocumentFormat>
						<pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
						<pwg:DocumentFormat>application/pdf</pwg:DocumentFormat>
						<scan:DocumentFormatExt>application/octet-stream</scan:DocumentFormatExt>
						<scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
						<scan:DocumentFormatExt>application/pdf</scan:DocumentFormatExt>
					</scan:DocumentFormats>
					<scan:SupportedResolutions>
						<scan:DiscreteResolutions>
							<scan:DiscreteResolution><scan:XResolution>75</scan:XResolution><scan:YResolution>75</scan:YResolution></scan:DiscreteResolution>
							<scan:DiscreteResolution><scan:XResolution>100</scan:XResolution><scan:YResolution>100</scan:YResolution></scan:DiscreteResolution>
							<scan:DiscreteResolution><scan:XResolution>200</scan:XResolution><scan:YResolution>200</scan:YResolution></scan:DiscreteResolution>
							<scan:DiscreteResolution><scan:XResolution>300</scan:XResolution><scan:YResolution>300</scan:YResolution></scan:DiscreteResolution>
							<scan:DiscreteResolution><scan:XResolution>600</scan:XResolution><scan:YResolution>600</scan:YResolution></scan:DiscreteResolution>
						</scan:DiscreteResolutions>
					</scan:SupportedResolutions>
					<scan:ColorSpaces><scan:ColorSpace>RGB</scan:ColorSpace></scan:ColorSpaces>
				</scan:SettingProfile>
			</scan:SettingProfiles>
			<scan:SupportedIntents>
				<scan:Intent>Document</scan:Intent>
				<scan:Intent>TextAndGraphic</scan:Intent>
				<scan:Intent>Photo</scan:Intent>
				<scan:Intent>Preview</scan:Intent>
			</scan:SupportedIntents>
			<scan:MaxOpticalXResolution>1200</scan:MaxOpticalXResolution>
			<scan:MaxOpticalYResolution>1200</scan:MaxOpticalYResolution>
			<scan:RiskyLeftMargin>0</scan:RiskyLeftMargin>
			<scan:RiskyRightMargin>0</scan:RiskyRightMargin>
			<scan:RiskyTopMargin>0</scan:RiskyTopMargin>
			<scan:RiskyBottomMargin>0</scan:RiskyBottomMargin>
		</scan:PlatenInputCaps>
	</scan:Platen>
	<scan:Adf>
		<scan:AdfSimplexInputCaps>
			<scan:MinWidth>591</scan:MinWidth>
			<scan:MaxWidth>2550</scan:MaxWidth>
			<scan:MinHeight>591</scan:MinHeight>
			<scan:MaxHeight>4200</scan:MaxHeight>
			<scan:SettingProfiles>
				<scan:SettingProfile>
					<scan:ColorModes>
						<scan:ColorMode>BlackAndWhite1</scan:ColorMode>
						<scan:ColorMode>Grayscale8</scan:ColorMode>
						<scan:ColorMode>RGB24</scan:ColorMode>
					</scan:ColorModes>
					<scan:DocumentFormats>
						<pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
						<pwg:DocumentFormat>application/pdf</pwg:DocumentFormat>
						<scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
						<scan:DocumentFormatExt>application/pdf</scan:DocumentFormatExt>
					</scan:DocumentFormats>
					<scan:SupportedResolutions>
						<scan:DiscreteResolutions>
							<scan:DiscreteResolution><scan:XResolution>100</scan:XResolution><scan:YResolution>100</scan:YResolution></scan:DiscreteResolution>
							<scan:DiscreteResolution><scan:XResolution>200</scan:XResolution><scan:YResolution>200</scan:YResolution></scan:DiscreteResolution>
							<scan:DiscreteResolution><scan:XResolution>300</scan:XResolution><scan:YResolution>300</scan:YResolution></scan:DiscreteResolution>
						</scan:DiscreteResolutions>
					</scan:SupportedResolutions>
				</scan:SettingProfile>
			</scan:SettingProfiles>
			<scan:SupportedIntents><scan:Intent>Document</scan:Intent><scan:Intent>TextAndGraphic</scan:Intent></scan:SupportedIntents>
		</scan:AdfSimplexInputCaps>
		<scan:AdfDuplexInputCaps>
			<scan:MinWidth>591</scan:MinWidth>
			<scan:MaxWidth>2550</scan:MaxWidth>
			<scan:MinHeight>591</scan:MinHeight>
			<scan:MaxHeight>4200</scan:MaxHeight>
			<scan:SettingProfiles>
				<scan:SettingProfile>
					<scan:ColorModes>
						<scan:ColorMode>Grayscale8</scan:ColorMode>
						<scan:ColorMode>RGB24</scan:ColorMode>
					</scan:ColorModes>
					<scan:DocumentFormats>
						<pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
						<scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
					</scan:DocumentFormats>
					<scan:SupportedResolutions>
						<scan:DiscreteResolutions>
							<scan:DiscreteResolution><scan:XResolution>300</scan:XResolution><scan:YResolution>300</scan:YResolution></scan:DiscreteResolution>
						</scan:DiscreteResolutions>
					</scan:SupportedResolutions>
				</scan:SettingProfile>
			</scan:SettingProfiles>
		</scan:AdfDuplexInputCaps>
		<scan:FeederCapacity>50</scan:FeederCapacity>
		<scan:AdfOptions>
			<scan:AdfOption>DetectPaperLoaded</scan:AdfOption>
			<scan:AdfOption>SelectSinglePage</scan:AdfOption>
			<scan:AdfOption>Duplex</scan:AdfOption>
		</scan:AdfOptions>
	</scan:Adf>
	<scan:eSCLConfigCap>
		<scan:StateSupport><scan:State>disabled</scan:State><scan:State>enabled</scan:State></scan:StateSupport>
	</scan:eSCLConfigCap>
</scan:ScannerCapabilities>
`

// PlatenPDFCapabilities are capabilities of a flatbed-only scanner that gives
// a resolution range, names its setting profile once and references it, and
// only offers PDF.
const PlatenPDFCapabilities = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerCapabilities xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm" xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03">
	<pwg:Version>2.5</pwg:Version>
	<pwg:MakeAndModel>Canon imageCLASS MF264dw</pwg:MakeAndModel>
	<scan:UUID>6d4ff0ce-6b11-11d8-8020-f4a997aa0000</scan:UUID>
	<scan:SettingProfiles>
		<scan:SettingProfile name="p1">
			<scan:ColorModes>
				<scan:ColorMode>RGB24</scan:ColorMode>
				<scan:ColorMode>Grayscale8</scan:ColorMode>
			</scan:ColorModes>
			<scan:DocumentFormats>
				<pwg:DocumentFormat>application/pdf</pwg:DocumentFormat>
			</scan:DocumentFormats>
			<scan:SupportedResolutions>
				<scan:ResolutionRange>
					<scan:XResolutionRange><scan:Min>75</scan:Min><scan:Max>600</scan:Max><scan:Normal>300</scan:Normal><scan:Step>1</scan:Step></scan:XResolutionRange>
					<scan:YResolutionRange><scan:Min>75</scan:Min><scan:Max>600</scan:Max><scan:Normal>300</scan:Normal><scan:Step>1</scan:Step></scan:YResolutionRange>
				</scan:ResolutionRange>
			</scan:SupportedResolutions>
		</scan:SettingProfile>
	</scan:SettingProfiles>
	<scan:Platen>
		<scan:PlatenInputCaps>
			<scan:MinWidth>16</scan:MinWidth>
			<scan:MaxWidth>2551</scan:MaxWidth>
			<scan:MinHeight>16</scan:MinHeight>
			<scan:MaxHeight>3295</scan:MaxHeight>
			<scan:SettingProfiles>
				<scan:SettingProfile ref="p1"/>
			</scan:SettingProfiles>
		</scan:PlatenInputCaps>
	</scan:Platen>
</scan:ScannerCapabilities>
`
