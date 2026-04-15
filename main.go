package main

import (
	"flag"
	"log"
	"net/http"
	"strings"
)

func main() {
	listenAddr := flag.String("listen", ":8080", "HTTP listen address (e.g. :8080)")
	basePath := flag.String("base-path", "/", "Base URL path (e.g. /api/v/1/apps/rdp/)")
	flag.Parse()

	// Normalize base path: must start and end with /
	bp := *basePath
	if !strings.HasPrefix(bp, "/") {
		bp = "/" + bp
	}
	if !strings.HasSuffix(bp, "/") {
		bp = bp + "/"
	}

	srv := NewServer(bp)

	log.Printf("Starting server on %s with base path %s", *listenAddr, bp)
	if err := http.ListenAndServe(*listenAddr, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
