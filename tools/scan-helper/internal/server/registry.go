package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net/url"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"trendlix.com/scan-helper/internal/config"
	"trendlix.com/scan-helper/internal/discovery"
	"trendlix.com/scan-helper/internal/escl"
)

// Scanner is a scanner as the HTTP API shows it.
type Scanner struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	URL         string   `json:"url"`
	Secure      bool     `json:"secure"`
	Sources     []string `json:"sources"`
	Duplex      bool     `json:"duplex"`
	ColorModes  []string `json:"colorModes"`
	Resolutions []int    `json:"resolutions"`
	Formats     []string `json:"formats"`
	Manual      bool     `json:"manual"`
}

// ScannerID derives a scanner's stable id from its eSCL URL.
func ScannerID(baseURL string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimRight(baseURL, "/"))))
	return hex.EncodeToString(sum[:])[:12]
}

const (
	capsTTL       = time.Hour
	capsRetry     = 30 * time.Second
	capsTimeout   = 5 * time.Second
	manualTimeout = 6 * time.Second
)

// Registry knows the scanners: found by mDNS in the background, plus the
// ones added by hand, with their capabilities cached.
type Registry struct {
	browser discovery.Browser
	client  *escl.Client
	store   *config.Store
	log     *log.Logger

	BrowseWindow time.Duration // how long one mDNS browse listens
	CapsWait     time.Duration // how long a round waits for capabilities
	ListWait     time.Duration // how long a list call waits for a round
	Interval     time.Duration // background refresh interval
	Expiry       time.Duration // forget scanners not seen for this long

	ctx       context.Context
	mu        sync.Mutex
	devices   map[string]*device
	caps      map[string]*capsEntry
	round     *round
	firstDone chan struct{}
	firstOnce sync.Once
	discErr   string
}

type device struct {
	plain, secure *discovery.Service
	lastSeen      time.Time
}

func (d *device) any() *discovery.Service {
	if d.secure != nil {
		return d.secure
	}
	return d.plain
}

type capsEntry struct {
	caps     *escl.Capabilities
	err      error
	at       time.Time
	fetching chan struct{}
}

type round struct {
	done     chan struct{}
	finished bool
}

// NewRegistry makes a registry; call Start to begin background discovery.
func NewRegistry(b discovery.Browser, c *escl.Client, s *config.Store, l *log.Logger) *Registry {
	return &Registry{
		browser:      b,
		client:       c,
		store:        s,
		log:          l,
		BrowseWindow: 1500 * time.Millisecond,
		CapsWait:     800 * time.Millisecond,
		ListWait:     2700 * time.Millisecond,
		Interval:     2 * time.Minute,
		Expiry:       10 * time.Minute,
		ctx:          context.Background(),
		devices:      map[string]*device{},
		caps:         map[string]*capsEntry{},
		firstDone:    make(chan struct{}),
	}
}

// Start runs discovery now and then every Interval until ctx ends.
func (r *Registry) Start(ctx context.Context) {
	r.ctx = ctx
	for _, m := range r.store.Snapshot().Scanners {
		r.ensureCaps(m.URL, false)
	}
	r.Refresh()
	go func() {
		t := time.NewTicker(r.Interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				r.Refresh()
			}
		}
	}()
}

// Refresh starts a discovery round unless one is running, and returns a
// channel closed when it ends.
func (r *Registry) Refresh() <-chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.round != nil && !r.round.finished {
		return r.round.done
	}
	rd := &round{done: make(chan struct{})}
	r.round = rd
	go r.run(rd)
	return rd.done
}

func (r *Registry) run(rd *round) {
	defer func() {
		r.mu.Lock()
		rd.finished = true
		r.mu.Unlock()
		close(rd.done)
		r.firstOnce.Do(func() { close(r.firstDone) })
	}()

	ctx, cancel := context.WithTimeout(r.ctx, r.BrowseWindow+3*time.Second)
	services, err := r.browser.Browse(ctx, r.BrowseWindow)
	cancel()

	now := time.Now()
	r.mu.Lock()
	if err != nil {
		if msg := err.Error(); msg != r.discErr {
			r.log.Printf("scanner discovery failed: %v (scanners can still be added by IP address)", err)
			r.discErr = msg
		}
	} else {
		r.discErr = ""
	}
	for _, s := range services {
		d := r.devices[s.Key()]
		if d == nil {
			d = &device{}
			r.devices[s.Key()] = d
		}
		var old *discovery.Service
		if s.Secure {
			old, d.secure = d.secure, &s
		} else {
			old, d.plain = d.plain, &s
		}
		if old == nil || old.BaseURL() != s.BaseURL() {
			r.log.Printf("found scanner %q at %s", displayName(s.Model(), "", s.Instance, s.BaseURL()), s.BaseURL())
		}
		d.lastSeen = now
	}
	for k, d := range r.devices {
		if now.Sub(d.lastSeen) > r.Expiry {
			r.log.Printf("scanner %q is no longer seen on the network", d.any().Instance)
			delete(r.devices, k)
		}
	}
	urls := r.allURLsLocked()
	r.mu.Unlock()

	var waits []<-chan struct{}
	for _, u := range urls {
		waits = append(waits, r.ensureCaps(u, false))
	}
	deadline := time.NewTimer(r.CapsWait)
	defer deadline.Stop()
	for _, w := range waits {
		select {
		case <-w:
		case <-deadline.C:
			return // the fetches carry on in the background
		}
	}
}

func (r *Registry) allURLsLocked() []string {
	var urls []string
	for _, d := range r.devices {
		for _, s := range []*discovery.Service{d.plain, d.secure} {
			if s != nil {
				urls = append(urls, s.BaseURL())
			}
		}
	}
	for _, m := range r.store.Snapshot().Scanners {
		urls = append(urls, m.URL)
	}
	return urls
}

// ensureCaps fetches a scanner's capabilities unless they are cached (or a
// recent attempt failed), and returns a channel closed when that is done.
func (r *Registry) ensureCaps(u string, force bool) <-chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	ce := r.caps[u]
	if ce != nil && ce.fetching != nil {
		return ce.fetching
	}
	if ce != nil && !force {
		if (ce.caps != nil && ce.err == nil && time.Since(ce.at) < capsTTL) || (ce.err != nil && time.Since(ce.at) < capsRetry) {
			done := make(chan struct{})
			close(done)
			return done
		}
	}
	if ce == nil {
		ce = &capsEntry{}
		r.caps[u] = ce
	}
	ch := make(chan struct{})
	ce.fetching = ch
	go func() {
		ctx, cancel := context.WithTimeout(r.ctx, capsTimeout)
		caps, err := r.client.Capabilities(ctx, u)
		cancel()
		r.mu.Lock()
		if err == nil {
			ce.caps, ce.err = caps, nil
		} else {
			ce.err = err // keep older capabilities, if any
		}
		ce.at = time.Now()
		ce.fetching = nil
		r.mu.Unlock()
		close(ch)
	}()
	return ch
}

// Caps returns a scanner's capabilities, fetching them if needed.
func (r *Registry) Caps(ctx context.Context, u string) (*escl.Capabilities, error) {
	r.mu.Lock()
	if ce := r.caps[u]; ce != nil && ce.caps != nil {
		c := ce.caps
		r.mu.Unlock()
		return c, nil
	}
	r.mu.Unlock()
	select {
	case <-r.ensureCaps(u, true):
	case <-ctx.Done():
		return nil, &escl.Error{Kind: escl.KindUnreachable, Err: ctx.Err()}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	ce := r.caps[u]
	if ce.caps != nil {
		return ce.caps, nil
	}
	return nil, ce.err
}

// List returns the scanners. With refresh, it runs a new discovery round
// first; otherwise it waits only for the first round after start. Either way
// it answers within ListWait.
func (r *Registry) List(ctx context.Context, refresh bool) []Scanner {
	wait := (<-chan struct{})(r.firstDone)
	if refresh {
		wait = r.Refresh()
	}
	t := time.NewTimer(r.ListWait)
	defer t.Stop()
	select {
	case <-wait:
	case <-t.C:
	case <-ctx.Done():
	}
	return r.Snapshot()
}

// Snapshot returns the scanners known right now.
func (r *Registry) Snapshot() []Scanner {
	r.mu.Lock()
	defer r.mu.Unlock()
	manual := map[string]config.ManualScanner{}
	for _, m := range r.store.Snapshot().Scanners {
		manual[m.URL] = m
	}
	out := []Scanner{}
	seen := map[string]bool{}
	for _, d := range r.devices {
		s := r.chooseLocked(d)
		u := s.BaseURL()
		if seen[u] {
			continue
		}
		seen[u] = true
		_, isManual := manual[u]
		out = append(out, r.scannerLocked(u, s.Model(), s.Instance, s.TXT, isManual))
	}
	for _, m := range r.store.Snapshot().Scanners {
		if !seen[m.URL] {
			seen[m.URL] = true
			out = append(out, r.scannerLocked(m.URL, m.Name, "", nil, true))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name); a != b {
			return a < b
		}
		return out[i].URL < out[j].URL
	})
	return out
}

// chooseLocked picks which endpoint of a device to show: HTTPS when the
// scanner offers it, unless it fails there and plain HTTP is available.
func (r *Registry) chooseLocked(d *device) *discovery.Service {
	if d.secure == nil {
		return d.plain
	}
	if d.plain != nil {
		if ce := r.caps[d.secure.BaseURL()]; ce != nil && ce.caps == nil && ce.err != nil {
			return d.plain
		}
	}
	return d.secure
}

func displayName(model, capsModel, instance, rawURL string) string {
	for _, n := range []string{model, capsModel, instance} {
		if n = strings.TrimSpace(n); n != "" {
			return n
		}
	}
	if u, err := url.Parse(rawURL); err == nil && u.Hostname() != "" {
		return "Scanner at " + u.Hostname()
	}
	return "Scanner"
}

func (r *Registry) scannerLocked(u, name, instance string, txt map[string]string, manual bool) Scanner {
	var caps *escl.Capabilities
	if ce := r.caps[u]; ce != nil {
		caps = ce.caps
	}
	capsModel := ""
	if caps != nil {
		capsModel = caps.MakeAndModel
	}
	sc := Scanner{
		ID:     ScannerID(u),
		Name:   displayName(name, capsModel, instance, u),
		URL:    u,
		Secure: strings.HasPrefix(strings.ToLower(u), "https:"),
		Manual: manual,
	}
	if caps != nil {
		sc.Sources = caps.Sources()
		sc.Duplex = caps.Duplex
		sc.ColorModes = caps.ColorModes()
		sc.Resolutions = caps.Resolutions()
		sc.Formats = caps.Formats()
	} else {
		sc.Sources, sc.ColorModes, sc.Duplex, sc.Formats = fromTXT(txt)
	}
	if len(sc.Sources) == 0 {
		sc.Sources = []string{"platen"}
	}
	if len(sc.ColorModes) == 0 {
		sc.ColorModes = []string{"color", "grayscale"}
	}
	if len(sc.Resolutions) == 0 {
		sc.Resolutions = []int{300}
	}
	if len(sc.Formats) == 0 {
		sc.Formats = []string{"image/jpeg"}
	}
	return sc
}

// fromTXT reads what the mDNS TXT record says, for scanners whose
// capabilities haven't been fetched (yet).
func fromTXT(txt map[string]string) (sources, modes []string, duplex bool, formats []string) {
	split := func(s string) []string {
		var out []string
		for _, p := range strings.Split(s, ",") {
			if p = strings.ToLower(strings.TrimSpace(p)); p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	for _, s := range split(txt["is"]) {
		switch s {
		case "platen":
			sources = append(sources, "platen")
		case "adf", "feeder":
			sources = append(sources, "feeder")
		}
	}
	for _, c := range split(txt["cs"]) {
		switch c {
		case "color":
			modes = append(modes, "color")
		case "grayscale":
			modes = append(modes, "grayscale")
		case "binary":
			modes = append(modes, "bw")
		}
	}
	formats = split(txt["pdl"])
	d := strings.ToLower(strings.TrimSpace(txt["duplex"]))
	duplex = d == "t" || d == "true"
	return sources, modes, duplex, formats
}

// target is a scanner a scan can run on.
type target struct {
	URL  string
	Name string
}

// Lookup finds a scanner by id among every known endpoint.
func (r *Registry) Lookup(id string) (target, bool) {
	for _, sc := range r.Snapshot() {
		if sc.ID == id {
			return target{URL: sc.URL, Name: sc.Name}, true
		}
	}
	// Also accept the other endpoint of a device (HTTP vs HTTPS).
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, d := range r.devices {
		for _, s := range []*discovery.Service{d.plain, d.secure} {
			if s != nil && ScannerID(s.BaseURL()) == id {
				return target{URL: s.BaseURL(), Name: displayName(s.Model(), "", s.Instance, s.BaseURL())}, true
			}
		}
	}
	return target{}, false
}

// apiError is an error with the HTTP status and message to answer.
type apiError struct {
	status int
	msg    string
}

func (e *apiError) Error() string { return e.msg }

// CandidateURLs turns what HR typed (a URL, a host or an IP address) into the
// eSCL URLs to try.
func CandidateURLs(input string) ([]string, error) {
	in := strings.TrimSpace(input)
	if in == "" || strings.ContainsAny(in, " \t\r\n") {
		return nil, fmt.Errorf("invalid address %q", input)
	}
	withScheme := strings.Contains(in, "://")
	raw := in
	if !withScheme {
		raw = "http://" + in
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil {
		return nil, fmt.Errorf("invalid address %q", input)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("invalid address %q", input)
	}
	path := strings.TrimRight(u.EscapedPath(), "/")
	if path == "" {
		path = "/eSCL"
	}
	host := strings.ToLower(u.Host)
	if withScheme {
		return []string{scheme + "://" + host + path}, nil
	}
	return []string{"http://" + host + path, "https://" + host + path}, nil
}

// AddManual checks for an eSCL scanner at what HR typed and saves it.
func (r *Registry) AddManual(ctx context.Context, input string) (Scanner, error) {
	cands, err := CandidateURLs(input)
	if err != nil {
		return Scanner{}, &apiError{400, "Type the scanner's IP address, for example 192.168.1.50, or its eSCL address, for example http://192.168.1.50/eSCL."}
	}
	type result struct {
		caps *escl.Capabilities
		err  error
	}
	results := make([]result, len(cands))
	var wg sync.WaitGroup
	for i, u := range cands {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, manualTimeout)
			defer cancel()
			c, err := r.client.Capabilities(cctx, u)
			results[i] = result{c, err}
		}()
	}
	wg.Wait()

	pick := -1
	for i, res := range results {
		// Prefer the encrypted endpoint when both answer.
		if res.err == nil && (pick < 0 || strings.HasPrefix(cands[i], "https:")) {
			pick = i
		}
	}
	shown := strings.TrimSpace(input)
	if pick < 0 {
		for _, res := range results {
			if escl.KindOf(res.err) == escl.KindNotScanner {
				r.log.Printf("adding scanner %q failed: %v", shown, res.err)
				return Scanner{}, &apiError{502, fmt.Sprintf("Something answered at %s, but it doesn't look like a network scanner (AirScan / eSCL). Check the address.", shown)}
			}
		}
		r.log.Printf("adding scanner %q failed: %v", shown, results[0].err)
		return Scanner{}, &apiError{502, fmt.Sprintf("No scanner answered at %s. Check the IP address, and that the scanner is switched on and on the same network as this computer.", shown)}
	}

	u, caps := cands[pick], results[pick].caps
	if err := r.store.Update(func(c *config.Config) {
		for i := range c.Scanners {
			if c.Scanners[i].URL == u {
				c.Scanners[i].Name = caps.MakeAndModel
				return
			}
		}
		c.Scanners = append(c.Scanners, config.ManualScanner{URL: u, Name: caps.MakeAndModel})
	}); err != nil {
		r.log.Printf("could not save the scanner list: %v", err)
		return Scanner{}, &apiError{500, "The scanner answered, but the helper couldn't save it on this computer."}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.caps[u] = &capsEntry{caps: caps, at: time.Now()}
	r.log.Printf("added scanner %q at %s", caps.MakeAndModel, u)
	return r.scannerLocked(u, caps.MakeAndModel, "", nil, true), nil
}

// RemoveManual forgets a scanner that was added by hand.
func (r *Registry) RemoveManual(id string) error {
	var found *config.ManualScanner
	for _, m := range r.store.Snapshot().Scanners {
		if ScannerID(m.URL) == id {
			found = &m
			break
		}
	}
	if found == nil {
		if _, ok := r.Lookup(id); ok {
			return &apiError{400, "This scanner was found on the network automatically, so it can't be removed. Only scanners added by IP address can be removed."}
		}
		return &apiError{404, "That scanner wasn't found. Refresh the list of scanners."}
	}
	if err := r.store.Update(func(c *config.Config) {
		c.Scanners = slices.DeleteFunc(c.Scanners, func(m config.ManualScanner) bool { return m.URL == found.URL })
	}); err != nil {
		r.log.Printf("could not save the scanner list: %v", err)
		return &apiError{500, "The helper couldn't save the change on this computer."}
	}
	r.log.Printf("removed scanner at %s", found.URL)
	return nil
}

// DiscoveryProblem is the last discovery error, if any, for the status page.
func (r *Registry) DiscoveryProblem() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.discErr
}
