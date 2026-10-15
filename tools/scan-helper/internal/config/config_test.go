package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenCreatesDefaultsAndSaves(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil || !strings.Contains(string(data), `"allowedOrigins": []`) {
		t.Fatalf("default config = %s, %v", data, err)
	}
	if err := s.Update(func(c *Config) {
		c.Scanners = append(c.Scanners, ManualScanner{URL: "http://192.168.1.50/eSCL/", Name: "Canon"})
		c.AllowedOrigins = append(c.AllowedOrigins, "HTTPS://Staging.Trendlix.com/")
	}); err != nil {
		t.Fatal(err)
	}
	again, err := Open(dir, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	c := again.Snapshot()
	if len(c.Scanners) != 1 || c.Scanners[0].URL != "http://192.168.1.50/eSCL" || c.AllowedOrigins[0] != "https://staging.trendlix.com" {
		t.Errorf("reloaded config = %+v", c)
	}
}

func TestOpenSetsBrokenFileAside(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	os.WriteFile(path, []byte("{not json"), 0o600)
	var logged []string
	s, err := Open(dir, func(f string, a ...any) { logged = append(logged, f) })
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Snapshot().Scanners) != 0 || len(logged) != 1 {
		t.Errorf("snapshot %+v, logged %v", s.Snapshot(), logged)
	}
	if b, _ := os.ReadFile(path + ".broken"); string(b) != "{not json" {
		t.Error("the broken file should be kept as config.json.broken")
	}
}
