package rdp

/*
#cgo CFLAGS: -I${SRCDIR} -D__STDC_NO_THREADS__
#cgo pkg-config: freerdp3 freerdp-client3 winpr3

#include "freerdp_bridge.h"
#include <stdlib.h>
*/
import "C"

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"runtime"
	"runtime/cgo"
	"sync"
	"unsafe"
)

// Frame types for wire protocol
const (
	FrameTypeJPEG = 0x00
	FrameTypeH264 = 0x01
)

// Frame represents a dirty rectangle update encoded as JPEG or raw H.264.
type Frame struct {
	Type        uint8  // FrameTypeJPEG or FrameTypeH264
	X, Y, W, H int
	Data        []byte // JPEG or H.264 NAL unit payload
}

// Connection represents an active RDP session backed by FreeRDP.
type Connection struct {
	ctx     *C.rdpContext
	handle  cgo.Handle
	frameCh chan Frame

	mu       sync.Mutex
	closed   bool
	onReady  func(width, height int)
	onClosed func(errCode int)
}

// ConnectParams holds the parameters for establishing an RDP connection.
type ConnectParams struct {
	Host     string
	Port     uint32
	Username string
	Password string
	Domain   string
	Width    int
	Height   int
}

// Connect establishes an RDP session to the specified host.
// frameCh receives JPEG-encoded dirty rectangle updates.
// onReady is called when the RDP desktop is ready (with negotiated dimensions).
// onClosed is called when the connection ends (with FreeRDP error code, 0 = success).
//
// The FreeRDP event loop runs on a dedicated OS thread (goroutine locked with LockOSThread).
func Connect(params ConnectParams, frameCh chan Frame, onReady func(int, int), onClosed func(int)) (*Connection, error) {
	conn := &Connection{
		frameCh:  frameCh,
		onReady:  onReady,
		onClosed: onClosed,
	}

	conn.handle = cgo.NewHandle(conn)

	cHost := C.CString(params.Host)
	cUser := C.CString(params.Username)
	cPass := C.CString(params.Password)
	cDomain := C.CString(params.Domain)
	defer C.free(unsafe.Pointer(cHost))
	defer C.free(unsafe.Pointer(cUser))
	defer C.free(unsafe.Pointer(cPass))
	defer C.free(unsafe.Pointer(cDomain))

	cParams := C.BridgeConnParams{
		hostname: cHost,
		port:     C.uint32_t(params.Port),
		username: cUser,
		password: cPass,
		domain:   cDomain,
		width:    C.uint32_t(params.Width),
		height:   C.uint32_t(params.Height),
		goHandle: C.uintptr_t(conn.handle),
	}

	// Connect on the current goroutine (which will be locked to OS thread
	// when called from the event loop goroutine)
	ctx := C.bridge_connect(&cParams)
	if ctx == nil {
		conn.handle.Delete()
		return nil, fmt.Errorf("FreeRDP connection failed")
	}

	conn.ctx = ctx

	// Start the event loop on a dedicated OS-thread-locked goroutine
	go conn.eventLoop()

	return conn, nil
}

func (c *Connection) eventLoop() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	C.bridge_run_event_loop(c.ctx)

	c.mu.Lock()
	ctx := c.ctx
	c.ctx = nil
	c.mu.Unlock()

	if ctx != nil {
		C.bridge_free(ctx)
	}
	c.handle.Delete()
}

// Disconnect cleanly closes the RDP session.
func (c *Connection) Disconnect() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.mu.Unlock()

	if c.ctx != nil {
		C.bridge_disconnect(c.ctx)
	}
}

// SendKeyboard sends a keyboard event to the RDP session.
func (c *Connection) SendKeyboard(flags, code uint16) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.ctx == nil {
		return
	}
	C.bridge_send_keyboard(c.ctx, C.uint16_t(flags), C.uint16_t(code))
}

// SendMouse sends a mouse event to the RDP session.
func (c *Connection) SendMouse(flags, x, y uint16) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.ctx == nil {
		return
	}
	C.bridge_send_mouse(c.ctx, C.uint16_t(flags), C.uint16_t(x), C.uint16_t(y))
}

// ============================================
// Exported callbacks called from C
// ============================================

//export goEndPaint
func goEndPaint(handle C.uintptr_t, data *C.uint8_t, dataLen C.int,
	x, y, w, h C.int, stride C.int) {

	conn := cgo.Handle(handle).Value().(*Connection)

	goX := int(x)
	goY := int(y)
	goW := int(w)
	goH := int(h)
	goStride := int(stride)

	if goW <= 0 || goH <= 0 {
		return
	}

	// Extract dirty rectangle from the BGRA32 framebuffer
	fullBuffer := unsafe.Slice((*byte)(unsafe.Pointer(data)), int(dataLen))

	// Create an RGBA image from the dirty rectangle
	// FreeRDP BGRA32 layout: B, G, R, A per pixel
	img := image.NewRGBA(image.Rect(0, 0, goW, goH))
	for row := 0; row < goH; row++ {
		srcOffset := (goY+row)*goStride + goX*4
		dstOffset := row * goW * 4
		for col := 0; col < goW; col++ {
			si := srcOffset + col*4
			di := dstOffset + col*4
			// BGRA → RGBA
			img.Pix[di+0] = fullBuffer[si+2] // R
			img.Pix[di+1] = fullBuffer[si+1] // G
			img.Pix[di+2] = fullBuffer[si+0] // B
			img.Pix[di+3] = fullBuffer[si+3] // A
		}
	}

	// JPEG encode directly (sync.Pool reverted)
	var buf bytes.Buffer
	err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 65})
	if err != nil {
		return
	}

	// Non-blocking send to frame channel
	frame := Frame{
		Type: FrameTypeJPEG,
		X:    goX,
		Y:    goY,
		W:    goW,
		H:    goH,
		Data: buf.Bytes(),
	}

	select {
	case conn.frameCh <- frame:
	default:
		// Drop frame if channel is full (backpressure)
	}
}

//export goOnReady
func goOnReady(handle C.uintptr_t, width, height C.int) {
	conn := cgo.Handle(handle).Value().(*Connection)
	if conn.onReady != nil {
		conn.onReady(int(width), int(height))
	}
}

//export goOnDisconnect
func goOnDisconnect(handle C.uintptr_t, errorCode C.int) {
	conn := cgo.Handle(handle).Value().(*Connection)
	if conn.onClosed != nil {
		conn.onClosed(int(errorCode))
	}
}
