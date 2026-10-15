//go:build darwin

package install

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlistsAreValid(t *testing.T) {
	if _, err := exec.LookPath("plutil"); err != nil {
		t.Skip("plutil not available")
	}
	dir := t.TempDir()
	exe := "/Users/Jane & Co/Library/Application Support/trendlix-scan-helper/TrendLIX Scan Helper.app/Contents/MacOS/trendlix-scan-helper"
	for name, content := range map[string]string{"agent.plist": agentPlist(exe), "Info.plist": infoPlist("1.0.0")} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("plutil", "-lint", p).CombinedOutput(); err != nil {
			t.Errorf("%s is not a valid plist: %s", name, out)
		}
	}
	out, err := exec.Command("plutil", "-extract", "ProgramArguments.0", "raw", filepath.Join(dir, "agent.plist")).Output()
	if err != nil || strings.TrimSpace(string(out)) != exe {
		t.Errorf("ProgramArguments.0 = %q, %v", out, err)
	}
}

func TestCopyExecutable(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "sub", "copy")
	if err := copyExecutable(dst); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(dst)
	if err != nil || fi.Mode().Perm()&0o100 == 0 || fi.Size() == 0 {
		t.Fatalf("copy: %v %v", fi, err)
	}
	if err := copyExecutable(dst); err != nil { // replacing works too
		t.Fatal(err)
	}
	if runningFrom(filepath.Dir(dst)) {
		t.Error("runningFrom should be false for another folder")
	}
}
