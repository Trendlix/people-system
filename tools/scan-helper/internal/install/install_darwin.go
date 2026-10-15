//go:build darwin

package install

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"trendlix.com/scan-helper/internal/config"
)

// Label is the LaunchAgent's label.
const Label = "com.trendlix.scan-helper"

const (
	appName = "TrendLIX Scan Helper.app"
	exeName = "trendlix-scan-helper"
)

// Supported reports whether start-at-login is available here.
func Supported() bool { return true }

func plistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", Label+".plist"), nil
}

func appDir() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, appName), nil
}

// IsInstalled reports whether the LaunchAgent exists.
func IsInstalled() bool {
	p, err := plistPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

func esc(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// The helper is placed in a minimal app bundle so that macOS can show its
// name and reason in the "find devices on your local network" prompt
// (Local Network privacy) when it runs at login.
func infoPlist(version string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key><string>` + Label + `</string>
	<key>CFBundleName</key><string>TrendLIX Scan Helper</string>
	<key>CFBundleDisplayName</key><string>TrendLIX Scan Helper</string>
	<key>CFBundleExecutable</key><string>` + exeName + `</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>` + esc(version) + `</string>
	<key>CFBundleVersion</key><string>` + esc(version) + `</string>
	<key>LSUIElement</key><true/>
	<key>LSBackgroundOnly</key><true/>
	<key>NSLocalNetworkUsageDescription</key><string>TrendLIX Scan Helper finds the office scanners on your network so you can scan documents into the People System.</string>
	<key>NSBonjourServices</key><array><string>_uscan._tcp</string><string>_uscans._tcp</string></array>
</dict>
</plist>
`
}

func agentPlist(exe string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>` + Label + `</string>
	<key>ProgramArguments</key>
	<array><string>` + esc(exe) + `</string><string>--background</string></array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
	<key>LimitLoadToSessionType</key><string>Aqua</string>
	<key>ProcessType</key><string>Standard</string>
</dict>
</plist>
`
}

func launchctl(args ...string) error {
	out, err := exec.Command("/bin/launchctl", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func domain() string { return fmt.Sprintf("gui/%d", os.Getuid()) }

// Install copies the helper into ~/Library/Application Support and loads a
// LaunchAgent that starts it at login (and now).
func Install(opts Options) ([]string, error) {
	app, err := appDir()
	if err != nil {
		return nil, err
	}
	exe := filepath.Join(app, "Contents", "MacOS", exeName)
	if err := os.MkdirAll(filepath.Dir(exe), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(app, "Contents", "Info.plist"), []byte(infoPlist(opts.Version)), 0o644); err != nil {
		return nil, err
	}
	if err := copyExecutable(exe); err != nil {
		return nil, fmt.Errorf("could not copy the helper to %s: %w", exe, err)
	}
	// Sign the small bundle (ad hoc) so macOS ties the Info.plist to it.
	// Best effort: the program itself is already signed.
	_ = exec.Command("/usr/bin/codesign", "--force", "--sign", "-", app).Run()

	plist, err := plistPath()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(plist), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(plist, []byte(agentPlist(exe)), 0o644); err != nil {
		return nil, err
	}

	_ = launchctl("bootout", domain()+"/"+Label) // replace an older copy
	var loadErr error
	for range 4 {
		if loadErr = launchctl("bootstrap", domain(), plist); loadErr == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if loadErr != nil {
		// Older macOS versions only know load/unload.
		_ = launchctl("unload", plist)
		if err := launchctl("load", "-w", plist); err != nil {
			return nil, errors.Join(loadErr, err)
		}
	}
	return []string{
		"Done. TrendLIX Scan Helper now starts by itself every time you log in.",
		"Installed in: " + app,
		"If macOS asks whether it may find devices on your local network, choose Allow.",
	}, nil
}

// Uninstall unloads and removes the LaunchAgent and the installed copy.
// Settings and the log stay in the config folder.
func Uninstall() ([]string, error) {
	var lines []string
	plist, err := plistPath()
	if err != nil {
		return nil, err
	}
	if err := launchctl("bootout", domain()+"/"+Label); err != nil {
		_ = launchctl("unload", plist)
	}
	if err := os.Remove(plist); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	app, err := appDir()
	if err != nil {
		return nil, err
	}
	if err := os.RemoveAll(app); err != nil {
		return nil, err
	}
	dir, _ := config.Dir()
	lines = append(lines,
		"Done. TrendLIX Scan Helper no longer starts at login, and the installed copy was removed.",
		"Your settings and log are kept in: "+dir+" (you can delete that folder).",
	)
	return lines, nil
}
