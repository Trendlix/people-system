//go:build !windows

package wia

// platformRunner: only Windows has WIA, so there is nothing to run here.
func platformRunner() Runner { return nil }
