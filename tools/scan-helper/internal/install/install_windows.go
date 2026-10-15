//go:build windows

package install

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/windows/registry"
)

const (
	runKey   = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValue = "TrendLIX Scan Helper"
	exeName  = "TrendLIX-Scan-Helper.exe"

	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
	createNoWindow        = 0x08000000
)

// Supported reports whether start-at-login is available here.
func Supported() bool { return true }

func installDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "Programs", "TrendLIX Scan Helper")
}

// IsInstalled reports whether the Run entry exists.
func IsInstalled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue(runValue)
	return err == nil
}

// stopOthers ends other running copies of the installed helper, so its file
// can be replaced or removed.
func stopOthers() {
	cmd := exec.Command("taskkill", "/F", "/IM", exeName, "/FI", fmt.Sprintf("PID ne %d", os.Getpid()))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if cmd.Run() == nil {
		time.Sleep(700 * time.Millisecond)
	}
}

// Install copies the helper to %LOCALAPPDATA%\Programs\TrendLIX Scan Helper,
// adds it to HKCU\...\CurrentVersion\Run and starts it in the background.
func Install(opts Options) ([]string, error) {
	dir := installDir()
	exe := filepath.Join(dir, exeName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(exe); err == nil && !runningFrom(dir) {
		stopOthers()
	}
	if err := copyExecutable(exe); err != nil {
		return nil, fmt.Errorf("could not copy the helper to %s: %w", exe, err)
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return nil, fmt.Errorf("could not add the helper to the programs that start at login: %w", err)
	}
	err = k.SetStringValue(runValue, `"`+exe+`" --background`)
	k.Close()
	if err != nil {
		return nil, fmt.Errorf("could not add the helper to the programs that start at login: %w", err)
	}

	lines := []string{
		"Done. TrendLIX Scan Helper now starts by itself every time you log in.",
		"Installed in: " + dir,
	}
	cmd := exec.Command(exe, "--background")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: detachedProcess | createNewProcessGroup}
	if err := cmd.Start(); err != nil {
		lines = append(lines, "It will start the next time you log in.")
	} else {
		_ = cmd.Process.Release()
	}
	lines = append(lines, "If Windows asks whether to allow it on the network, choose Allow (private networks).")
	return lines, nil
}

// Uninstall removes the Run entry, stops the helper and removes the
// installed copy. Settings and the log stay in the config folder.
func Uninstall() ([]string, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err == nil {
		if err := k.DeleteValue(runValue); err != nil && !errors.Is(err, registry.ErrNotExist) {
			k.Close()
			return nil, err
		}
		k.Close()
	}
	dir := installDir()
	lines := []string{"Done. TrendLIX Scan Helper no longer starts at login."}
	if runningFrom(dir) {
		lines = append(lines, "To remove the program itself, close this window and delete the folder "+dir)
		return lines, nil
	}
	stopOthers()
	var rmErr error
	for range 5 {
		if rmErr = os.RemoveAll(dir); rmErr == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if rmErr != nil {
		lines = append(lines, "The installed copy couldn't be removed; delete the folder "+dir+" by hand.")
	} else {
		lines = append(lines, "The installed copy was removed and the helper stopped.")
	}
	if base, err := os.UserConfigDir(); err == nil {
		lines = append(lines, "Your settings and log are kept in: "+filepath.Join(base, "trendlix-scan-helper")+" (you can delete that folder).")
	}
	return lines, nil
}
