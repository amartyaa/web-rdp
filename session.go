package main

import (
	"encoding/binary"
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
	"vcollab-web-rdp/rdp"
)

// ClientMessage represents any JSON message from the browser client.
type ClientMessage struct {
	Type     string `json:"type"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	Domain   string `json:"domain,omitempty"`
	// Requested resolution (from auth message)
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
	// Keyboard
	Code  uint16 `json:"code,omitempty"`
	Flags uint16 `json:"flags,omitempty"`
	// Mouse
	X uint16 `json:"x,omitempty"`
	Y uint16 `json:"y,omitempty"`
}

// ServerMessage represents a JSON message sent from server to browser.
type ServerMessage struct {
	Type    string `json:"type"`
	Width   int    `json:"width,omitempty"`
	Height  int    `json:"height,omitempty"`
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// Session manages a single WebSocket client and its associated RDP connection.
type Session struct {
	conn    *websocket.Conn
	mu      sync.Mutex // protects writes to conn
	done    chan struct{}
	closed  bool
	rdpConn *rdp.Connection
	frameCh chan rdp.Frame
}

// NewSession creates a new session for a WebSocket connection.
func NewSession(conn *websocket.Conn) *Session {
	return &Session{
		conn:    conn,
		done:    make(chan struct{}),
		frameCh: make(chan rdp.Frame, 30), // buffer up to 30 frames
	}
}

// Run processes messages from the WebSocket client. Blocks until the connection closes.
func (s *Session) Run() {
	defer s.Close()

	for {
		_, msgData, err := s.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			return
		}

		var msg ClientMessage
		if err := json.Unmarshal(msgData, &msg); err != nil {
			log.Printf("Invalid message format: %v", err)
			continue
		}

		switch msg.Type {
		case "auth":
			s.handleAuth(&msg)
		case "key":
			s.handleKey(&msg)
		case "mouse":
			s.handleMouse(&msg)
		default:
			log.Printf("Unknown message type: %s", msg.Type)
		}
	}
}

func (s *Session) handleAuth(msg *ClientMessage) {
	if msg.Username == "" || msg.Password == "" {
		s.sendJSON(ServerMessage{
			Type:  "auth_fail",
			Error: "username and password are required",
		})
		return
	}

	log.Printf("Auth received: user=%s domain=%s requestedRes=%dx%d", msg.Username, msg.Domain, msg.Width, msg.Height)

	// Use client-requested resolution, fall back to 1920x1080
	reqW := msg.Width
	reqH := msg.Height
	if reqW <= 0 || reqH <= 0 {
		reqW = 1920
		reqH = 1080
	}
	// Clamp to reasonable bounds
	if reqW < 800 { reqW = 800 }
	if reqH < 600 { reqH = 600 }
	if reqW > 3840 { reqW = 3840 }
	if reqH > 2160 { reqH = 2160 }
	// Ensure even dimensions (codec compatibility)
	reqW = (reqW / 2) * 2
	reqH = (reqH / 2) * 2

	// Connect to local RDP service via FreeRDP
	params := rdp.ConnectParams{
		Host:     "localhost",
		Port:     3389,
		Username: msg.Username,
		Password: msg.Password,
		Domain:   msg.Domain,
		Width:    reqW,
		Height:   reqH,
	}

	conn, err := rdp.Connect(params, s.frameCh,
		func(width, height int) {
			// RDP desktop ready callback
			log.Printf("RDP connected: %dx%d", width, height)
			s.sendJSON(ServerMessage{
				Type:   "auth_ok",
				Width:  width,
				Height: height,
			})
		},
		func(errCode int) {
			// RDP disconnected callback
			log.Printf("RDP disconnected: error=0x%08x", errCode)
			s.sendJSON(ServerMessage{
				Type:    "error",
				Message: "RDP session ended",
			})
		},
	)

	if err != nil {
		log.Printf("RDP connection failed: %v", err)
		s.sendJSON(ServerMessage{
			Type:  "auth_fail",
			Error: "Failed to connect to RDP: " + err.Error(),
		})
		return
	}

	s.rdpConn = conn

	// Start frame relay goroutine
	go s.relayFrames()
}

// relayFrames reads frames from the RDP frame channel and sends them as
// binary WebSocket messages.
func (s *Session) relayFrames() {
	for {
		select {
		case frame, ok := <-s.frameCh:
			if !ok {
				return
			}
			s.sendFrame(frame)
		case <-s.done:
			return
		}
	}
}

// sendFrame encodes a frame as a binary message:
// [1B type][2B x][2B y][2B w][2B h][payload]
// type: 0x00 = JPEG, 0x01 = H.264 NAL unit
// All uint16 values in little-endian.
func (s *Session) sendFrame(frame rdp.Frame) {
	header := make([]byte, 9)
	header[0] = frame.Type
	binary.LittleEndian.PutUint16(header[1:3], uint16(frame.X))
	binary.LittleEndian.PutUint16(header[3:5], uint16(frame.Y))
	binary.LittleEndian.PutUint16(header[5:7], uint16(frame.W))
	binary.LittleEndian.PutUint16(header[7:9], uint16(frame.H))

	data := make([]byte, 9+len(frame.Data))
	copy(data[0:9], header)
	copy(data[9:], frame.Data)

	s.sendBinary(data)
}

func (s *Session) handleKey(msg *ClientMessage) {
	if s.rdpConn == nil {
		return
	}
	s.rdpConn.SendKeyboard(msg.Flags, msg.Code)
}

func (s *Session) handleMouse(msg *ClientMessage) {
	if s.rdpConn == nil {
		return
	}
	s.rdpConn.SendMouse(msg.Flags, msg.X, msg.Y)
}

func (s *Session) sendJSON(msg ServerMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if err := s.conn.WriteJSON(msg); err != nil {
		log.Printf("WebSocket write error: %v", err)
	}
}

func (s *Session) sendBinary(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if err := s.conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
		log.Printf("WebSocket binary write error: %v", err)
	}
}

// Close shuts down the session, RDP connection, and WebSocket.
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	close(s.done)

	// Disconnect RDP
	if s.rdpConn != nil {
		go s.rdpConn.Disconnect() // async to avoid deadlock
	}

	s.conn.Close()
	log.Println("Session closed")
}
