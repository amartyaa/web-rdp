package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"strings"
)

var (
	listenAddr string
	basePath   string
)

func init() {
	flag.StringVar(&listenAddr, "listen", ":8080", "HTTP listen address (e.g. :8080)")
	flag.StringVar(&basePath, "base-path", "/", "Base URL path (e.g. /api/v/1/apps/rdp/)")
}

// runServer starts the HTTP server and blocks until ctx is cancelled.
// It performs a graceful shutdown when the context is done.
func runServer(ctx context.Context) error {
	// Normalize base path: must start and end with /
	bp := basePath
	if !strings.HasPrefix(bp, "/") {
		bp = "/" + bp
	}
	if !strings.HasSuffix(bp, "/") {
		bp = bp + "/"
	}

	srv := NewServer(bp)

	httpServer := &http.Server{
		Addr:    listenAddr,
		Handler: srv,
	}

	// Start server in a goroutine
	errCh := make(chan error, 1)
	go func() {
		log.Printf("Starting server on %s with base path %s", listenAddr, bp)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
		close(errCh)
	}()

	// Wait for context cancellation (service stop / signal)
	<-ctx.Done()
	log.Println("Shutting down server...")

	// Graceful shutdown with a timeout
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*1e9) // 10 seconds
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server shutdown error: %v", err)
		return err
	}

	// Check if the server encountered an error before shutdown
	if err, ok := <-errCh; ok {
		return err
	}

	log.Println("Server stopped gracefully")
	return nil
}

func main() {
	flag.Parse()
	runService()
}
