//go:build !windows

package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func runService() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle SIGTERM (systemd stop) and SIGINT (Ctrl+C)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		log.Printf("Received signal: %v", sig)
		cancel()
	}()

	if err := runServer(ctx); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
