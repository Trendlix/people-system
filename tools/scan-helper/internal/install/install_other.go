//go:build !darwin && !windows

package install

import "errors"

var errUnsupported = errors.New("starting at login is only set up on macOS and Windows; start the helper from your desktop's autostart settings instead")

// Supported reports whether start-at-login is available here.
func Supported() bool { return false }

// IsInstalled reports whether the helper starts at login.
func IsInstalled() bool { return false }

// Install is not available on this system.
func Install(Options) ([]string, error) { return nil, errUnsupported }

// Uninstall is not available on this system.
func Uninstall() ([]string, error) { return nil, errUnsupported }
