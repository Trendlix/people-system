// Package config keeps the helper's small settings file,
// <user config dir>/trendlix-scan-helper/config.json.
package config

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
)

// DirName is the helper's folder inside the user's config directory.
const DirName = "trendlix-scan-helper"

// ManualScanner is a scanner added by its address.
type ManualScanner struct {
	URL  string `json:"url"`
	Name string `json:"name,omitempty"`
}

// Config is the content of config.json.
type Config struct {
	// AllowedOrigins are web origins allowed to use the helper besides
	// https://people.trendlix.com and http://localhost:3000.
	AllowedOrigins []string        `json:"allowedOrigins"`
	Scanners       []ManualScanner `json:"scanners"`
}

// Dir returns the helper's config directory, creating it if needed.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, DirName)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// Store holds the config and saves it on every change.
type Store struct {
	mu   sync.Mutex
	path string
	cfg  Config
}

// Open loads dir/config.json, writing a default one if there is none. A file
// that can't be read is set aside as config.json.broken so the helper still
// starts; logf reports that.
func Open(dir string, logf func(format string, args ...any)) (*Store, error) {
	s := &Store{path: filepath.Join(dir, "config.json")}
	data, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		if err := s.saveLocked(); err != nil {
			logf("could not write %s: %v", s.path, err)
		}
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(data, &s.cfg); err != nil {
			bad := s.path + ".broken"
			_ = os.Remove(bad)
			_ = os.Rename(s.path, bad)
			logf("%s could not be read (%v); it was renamed to %s and default settings are used", s.path, err, bad)
			s.cfg = Config{}
			if err := s.saveLocked(); err != nil {
				logf("could not write %s: %v", s.path, err)
			}
		}
	}
	s.cfg = normalize(s.cfg)
	return s, nil
}

// Path is the config file's location.
func (s *Store) Path() string { return s.path }

// Snapshot returns a copy of the current config.
func (s *Store) Snapshot() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return clone(s.cfg)
}

// Update changes the config and saves it. If saving fails, nothing changes.
func (s *Store) Update(fn func(*Config)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.cfg
	next := clone(s.cfg)
	fn(&next)
	s.cfg = normalize(next)
	if err := s.saveLocked(); err != nil {
		s.cfg = old
		return err
	}
	return nil
}

func (s *Store) saveLocked() error {
	data, err := json.MarshalIndent(normalize(s.cfg), "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func clone(c Config) Config {
	return Config{AllowedOrigins: slices.Clone(c.AllowedOrigins), Scanners: slices.Clone(c.Scanners)}
}

func normalize(c Config) Config {
	out := Config{AllowedOrigins: []string{}, Scanners: []ManualScanner{}}
	for _, o := range c.AllowedOrigins {
		if o = NormalizeOrigin(o); o != "" && !slices.Contains(out.AllowedOrigins, o) {
			out.AllowedOrigins = append(out.AllowedOrigins, o)
		}
	}
	for _, m := range c.Scanners {
		m.URL = strings.TrimRight(strings.TrimSpace(m.URL), "/")
		m.Name = strings.TrimSpace(m.Name)
		if m.URL != "" && !slices.ContainsFunc(out.Scanners, func(x ManualScanner) bool { return x.URL == m.URL }) {
			out.Scanners = append(out.Scanners, m)
		}
	}
	return out
}

// NormalizeOrigin lower-cases an origin and drops a trailing slash.
func NormalizeOrigin(o string) string {
	return strings.TrimRight(strings.ToLower(strings.TrimSpace(o)), "/")
}
