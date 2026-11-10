// Package progress carries where a scan stands, from the code that talks to
// the scanner to the code that answers GET /v1/scan/state, through the scan's
// context. A scan whose context carries nothing reports nothing.
package progress

import "context"

// The stages of a scan.
const (
	Connecting   = "connecting"   // reaching the scanner and starting the scan
	Scanning     = "scanning"     // the scanner is scanning a page
	Transferring = "transferring" // a page is on its way: from the scanner, or the finished scan to the web page
	Idle         = "idle"         // no scan
)

// Func is told each new stage, and the page it is about (1 for the first; 0
// before the first page).
type Func func(stage string, page int)

type key struct{}

// With returns a context that reports a scan's progress to f.
func With(ctx context.Context, f Func) context.Context {
	if f == nil {
		return ctx
	}
	return context.WithValue(ctx, key{}, f)
}

// Report tells the scan's watcher, if any, its new stage.
func Report(ctx context.Context, stage string, page int) {
	if f, ok := ctx.Value(key{}).(Func); ok {
		f(stage, page)
	}
}
