#ifndef FREERDP_BRIDGE_H
#define FREERDP_BRIDGE_H

#include <freerdp/freerdp.h>
#include <freerdp/client.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/channels/channels.h>
#include <freerdp/codec/color.h>
#include <winpr/synch.h>
#include <winpr/thread.h>

#include <stdint.h>

/* BridgeContext extends rdpClientContext with a handle back to Go. */
typedef struct {
    rdpClientContext clientContext;
    uintptr_t       goHandle;    /* cgo.Handle for routing callbacks to Go */
    int             desktopReady;
} BridgeContext;

/* Connection parameters passed from Go to C. */
typedef struct {
    const char* hostname;
    uint32_t    port;
    const char* username;
    const char* password;
    const char* domain;
    uint32_t    width;
    uint32_t    height;
    uintptr_t   goHandle;
} BridgeConnParams;

/*
 * bridge_connect: Creates a FreeRDP instance, configures it with the given
 * parameters, and returns a pointer to the rdpContext. Returns NULL on failure.
 * The caller must call bridge_run_event_loop in a dedicated thread to process
 * RDP events, and bridge_disconnect + bridge_free to clean up.
 */
rdpContext* bridge_connect(BridgeConnParams* params);

/*
 * bridge_run_event_loop: Runs the FreeRDP event loop. Blocks until the
 * connection ends. Must be called from a dedicated OS thread.
 * Returns 0 on clean shutdown, non-zero on error.
 */
int bridge_run_event_loop(rdpContext* context);

/*
 * bridge_disconnect: Triggers an orderly disconnect and cleans up.
 */
void bridge_disconnect(rdpContext* context);

/*
 * bridge_free: Frees the FreeRDP context. Call after disconnect.
 */
void bridge_free(rdpContext* context);

/*
 * bridge_send_keyboard: Forwards a keyboard event to the RDP session.
 */
void bridge_send_keyboard(rdpContext* context, uint16_t flags, uint16_t code);

/*
 * bridge_send_mouse: Forwards a mouse event to the RDP session.
 */
void bridge_send_mouse(rdpContext* context, uint16_t flags, uint16_t x, uint16_t y);

/*
 * Go callback declarations (implemented in rdp.go via //export).
 * These are called from the C bridge code.
 */
extern void goEndPaint(uintptr_t handle,
                       uint8_t* data, int dataLen,
                       int x, int y, int w, int h,
                       int stride);

extern void goOnReady(uintptr_t handle, int width, int height);

extern void goOnDisconnect(uintptr_t handle, int errorCode);

#endif /* FREERDP_BRIDGE_H */
