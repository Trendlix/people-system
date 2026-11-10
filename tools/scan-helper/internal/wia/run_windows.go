//go:build windows

package wia

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

func platformRunner() Runner { return runPowerShell }

// powerShell is Windows PowerShell in the Windows folder itself, never one
// found on the PATH.
func powerShell() string {
	dir, err := windows.GetSystemDirectory()
	if err != nil || dir == "" {
		root := os.Getenv("SystemRoot")
		if root == "" {
			root = `C:\Windows`
		}
		dir = filepath.Join(root, "System32")
	}
	return filepath.Join(dir, "WindowsPowerShell", "v1.0", "powershell.exe")
}

// tail keeps the last bytes written to it, for the log when PowerShell fails.
type tail struct{ b []byte }

func (t *tail) Write(p []byte) (int, error) {
	t.b = append(t.b, p...)
	if len(t.b) > 2048 {
		t.b = t.b[len(t.b)-2048:]
	}
	return len(p), nil
}

// runPowerShell runs a script with Windows PowerShell, without a window (the
// helper may run in the background), and hands each line it writes to line.
// The process is stopped when ctx ends.
func runPowerShell(ctx context.Context, script string, env []string, line func(string)) error {
	cmd := exec.CommandContext(ctx, powerShell(), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), env...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	cmd.WaitDelay = 5 * time.Second
	stderr := &tail{}
	cmd.Stderr = stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line(strings.TrimRight(sc.Text(), "\r"))
	}
	err = cmd.Wait()
	if msg := strings.TrimSpace(string(stderr.b)); err != nil && msg != "" {
		return fmt.Errorf("%w: %s", err, firstLine(msg))
	}
	return err
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(s, "\n")
	return strings.TrimSpace(s)
}
