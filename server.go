package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

//go:embed web/*
var webFS embed.FS

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 65536,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in dev
	},
}

// Server is the main HTTP server that serves the UI and handles WebSocket connections.
type Server struct {
	basePath string
	mux      *http.ServeMux
}

// NewServer creates a new Server with routes mounted under basePath.
func NewServer(basePath string) *Server {
	s := &Server{
		basePath: basePath,
		mux:      http.NewServeMux(),
	}

	// Serve embedded static files
	webContent, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("Failed to create sub-filesystem: %v", err)
	}
	fileServer := http.FileServer(http.FS(webContent))

	// WebSocket endpoint
	s.mux.HandleFunc(basePath+"ws", s.handleWebSocket)

	// Static files (index.html, style.css, app.js)
	s.mux.Handle(basePath, http.StripPrefix(basePath, fileServer))

	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Redirect base path without trailing slash
	if r.URL.Path == strings.TrimSuffix(s.basePath, "/") && s.basePath != "/" {
		http.Redirect(w, r, s.basePath, http.StatusMovedPermanently)
		return
	}
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	log.Printf("WebSocket connection from %s", r.RemoteAddr)

	session := NewSession(conn)
	session.Run()
}
