//go:build !windows

package main

// detachConsole does nothing outside Windows.
func detachConsole() {}

// pauseIfOwnConsole does nothing outside Windows: a macOS Terminal window
// stays open after the program ends.
func pauseIfOwnConsole() {}
