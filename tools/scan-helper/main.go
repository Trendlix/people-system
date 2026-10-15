// TrendLIX Scan Helper lets the People System web app scan from network
// scanners (eSCL / AirScan). It serves a small HTTP API on 127.0.0.1:47815.
//
// Usage:
//
//	trendlix-scan-helper            run the helper
//	trendlix-scan-helper install    start it at login (and now)
//	trendlix-scan-helper uninstall  stop starting it at login, remove the installed copy
//	trendlix-scan-helper version    print the version
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"trendlix.com/scan-helper/internal/config"
	"trendlix.com/scan-helper/internal/discovery"
	"trendlix.com/scan-helper/internal/escl"
	"trendlix.com/scan-helper/internal/install"
	"trendlix.com/scan-helper/internal/server"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "1.0.0"

const statusURL = "http://127.0.0.1:47815"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	cmd := ""
	if len(args) > 0 {
		cmd = strings.ToLower(args[0])
	}
	switch {
	case cmd == "" || cmd == "run" || strings.HasPrefix(cmd, "-psn_"):
		background := len(args) > 1 && args[1] == "--background"
		return serve(background)
	case cmd == "--background" || cmd == "-background":
		return serve(true)
	case cmd == "install":
		return doInstall()
	case cmd == "uninstall":
		return doUninstall()
	case cmd == "version" || cmd == "--version" || cmd == "-version" || cmd == "-v":
		fmt.Println("TrendLIX Scan Helper " + version)
		return 0
	case cmd == "help" || cmd == "--help" || cmd == "-help" || cmd == "-h" || cmd == "/?":
		usage(os.Stdout)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "Unknown command %q.\n\n", args[0])
		usage(os.Stderr)
		return 2
	}
}

func usage(w io.Writer) {
	fmt.Fprintf(w, `TrendLIX Scan Helper %s: scan from network scanners into the People System.

Usage:
  %[2]s              run the helper (status page: %[3]s)
  %[2]s install      start the helper by itself every time you log in
  %[2]s uninstall    stop starting it at login and remove the installed copy
  %[2]s version      print the version
`, version, filepath.Base(os.Args[0]), statusURL)
}

// teeWriter writes to every writer and ignores their errors, so a closed
// console never stops the log file.
type teeWriter []io.Writer

func (t teeWriter) Write(p []byte) (int, error) {
	for _, w := range t {
		_, _ = w.Write(p)
	}
	return len(p), nil
}

// setupLogging logs to stderr and to helper.log in the config folder.
func setupLogging() (*log.Logger, string, func()) {
	writers := teeWriter{os.Stderr}
	logPath := ""
	closeFn := func() {}
	if dir, err := config.Dir(); err == nil {
		logPath = filepath.Join(dir, "helper.log")
		if fi, err := os.Stat(logPath); err == nil && fi.Size() > 2<<20 {
			_ = os.Remove(logPath + ".old")
			_ = os.Rename(logPath, logPath+".old")
		}
		if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
			writers = append(writers, f)
			closeFn = func() { f.Close() }
		}
	}
	return log.New(writers, "", log.LstdFlags), logPath, closeFn
}

func stdinIsTerminal() bool {
	fi, err := os.Stdin.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

func serve(background bool) int {
	if background {
		detachConsole()
	}
	logger, logPath, closeLog := setupLogging()
	defer closeLog()

	dir, err := config.Dir()
	if err != nil {
		logger.Printf("can't find a folder for settings: %v", err)
		pauseIfOwnConsole()
		return 1
	}
	store, err := config.Open(dir, logger.Printf)
	if err != nil {
		logger.Printf("can't read the settings in %s: %v", dir, err)
		pauseIfOwnConsole()
		return 1
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	ln, err := server.Listen(server.DefaultPort)
	if err != nil {
		if v, ok := server.ProbeHelper(server.DefaultPort); ok && !background {
			fmt.Printf("TrendLIX Scan Helper is already running (version %s), so there is nothing more to do.\nYou can check it at %s\n", v, statusURL)
			pauseIfOwnConsole()
			return 0
		}
		if !background {
			logger.Printf("can't start: port %d on this computer is already in use by another program (%v)", server.DefaultPort, err)
			fmt.Fprintf(os.Stderr, "\nTrendLIX Scan Helper can't start because port %d on this computer is already used by another program.\nClose that program, or restart the computer, and try again.\n", server.DefaultPort)
			pauseIfOwnConsole()
			return 1
		}
		// Started at login while another copy holds the port (for example one
		// opened by hand): wait and take over when it closes.
		logger.Printf("port %d is in use (another copy of the helper is probably running); waiting for it to close", server.DefaultPort)
		for ln == nil {
			select {
			case <-sigCh:
				return 0
			case <-time.After(5 * time.Second):
			}
			ln, _ = server.Listen(server.DefaultPort)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client := escl.NewClient("TrendLIX-Scan-Helper/" + version)
	reg := server.NewRegistry(discovery.MDNS{}, client, store, logger)
	srv := server.New(server.Options{
		Version:    version,
		Registry:   reg,
		Client:     client,
		Config:     store,
		Log:        logger,
		Background: background,
		LogPath:    logPath,
	})
	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          log.New(io.Discard, "", 0),
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.Serve(ln) }()
	reg.Start(ctx)

	logger.Printf("TrendLIX Scan Helper %s is running on %s", version, statusURL)
	if !background {
		fmt.Printf("\nTrendLIX Scan Helper %s is running.\n  Status page: %s\n  Log file:    %s\n\nKeep this window open while you scan from the People System.\nTo stop the helper, close this window or press Ctrl+C.\n", version, statusURL, logPath)
	}

	installCh := make(chan struct{}, 1)
	if !background && stdinIsTerminal() && install.Supported() && !install.IsInstalled() {
		fmt.Printf("\nTo start the helper by itself every time you log in, type Y and press Enter.\n")
		go func() {
			in := bufio.NewScanner(os.Stdin)
			for in.Scan() {
				if a := strings.ToLower(strings.TrimSpace(in.Text())); a == "y" || a == "yes" {
					installCh <- struct{}{}
					return
				}
			}
		}()
	}

	stop := func() {
		cancel()
		sctx, scancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer scancel()
		_ = httpSrv.Shutdown(sctx)
	}

	select {
	case <-sigCh:
		stop()
		logger.Printf("stopped")
		return 0
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return 0
		}
		logger.Printf("the helper stopped unexpectedly: %v", err)
		return 1
	case <-installCh:
		// Hand over to the installed copy: free the port, then install it
		// (which starts it).
		stop()
		logger.Printf("installing to start at login")
		return finishInstall()
	}
}

func doInstall() int { return finishInstall() }

func finishInstall() int {
	lines, err := install.Install(install.Options{Version: version})
	if err != nil {
		fmt.Fprintf(os.Stderr, "\nCouldn't set up TrendLIX Scan Helper to start at login:\n  %v\n", err)
		pauseIfOwnConsole()
		return 1
	}
	fmt.Println()
	for _, l := range lines {
		fmt.Println(l)
	}
	running := false
	for range 16 {
		if _, ok := server.ProbeHelper(server.DefaultPort); ok {
			running = true
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if running {
		fmt.Printf("It is running now: %s\nYou can close this window.\n", statusURL)
	} else {
		fmt.Println("It isn't answering yet; it will start the next time you log in.")
	}
	pauseIfOwnConsole()
	return 0
}

func doUninstall() int {
	lines, err := install.Uninstall()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Couldn't uninstall TrendLIX Scan Helper:\n  %v\n", err)
		pauseIfOwnConsole()
		return 1
	}
	for _, l := range lines {
		fmt.Println(l)
	}
	pauseIfOwnConsole()
	return 0
}
