//go:build windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

var (
	kernel32                  = syscall.NewLazyDLL("kernel32.dll")
	procFreeConsole           = kernel32.NewProc("FreeConsole")
	procGetConsoleProcessList = kernel32.NewProc("GetConsoleProcessList")
)

// detachConsole closes the console window Windows opens for the helper when
// it starts at login, so it runs in the background.
func detachConsole() {
	_, _, _ = procFreeConsole.Call()
}

// ownConsole reports whether this program is alone in its console window,
// which means it was started by double-clicking it.
func ownConsole() bool {
	var pids [4]uint32
	n, _, _ := procGetConsoleProcessList.Call(uintptr(unsafe.Pointer(&pids[0])), uintptr(len(pids)))
	return n == 1
}

// pauseIfOwnConsole keeps a double-clicked window open so its message can
// be read.
func pauseIfOwnConsole() {
	if !ownConsole() {
		return
	}
	fmt.Print("\nPress Enter to close this window.")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}
