//go:build windows

package main

import (
	"os"
	"os/signal"
	"syscall"
)

// waitForSignal blocks until SIGINT or SIGTERM is received.
// Used for interactive (non-service) mode on Windows.
func waitForSignal() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
}
