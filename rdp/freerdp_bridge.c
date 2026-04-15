/*
 * FreeRDP v3 Bridge — C implementation
 *
 * This file implements the FreeRDP client lifecycle:
 *   1. Context allocation and settings configuration
 *   2. Pre-connect: security negotiation, certificate preferences
 *   3. Post-connect: GDI initialization, paint callback registration
 *   4. Event loop: WaitForMultipleObjects + check event handles
 *   5. EndPaint: extract dirty region from framebuffer, forward to Go
 *   6. Input forwarding: keyboard and mouse events
 *   7. Disconnect and cleanup
 */

#include "freerdp_bridge.h"

#include <freerdp/freerdp.h>
#include <freerdp/client.h>
#include <freerdp/client/channels.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/gdi/gfx.h>
#include <freerdp/channels/channels.h>

#include <winpr/synch.h>
#include <winpr/thread.h>
#include <winpr/assert.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ============================================
   Paint Callbacks
   ============================================ */

static BOOL bridge_begin_paint(rdpContext* context)
{
    rdpGdi* gdi;
    WINPR_ASSERT(context);

    gdi = context->gdi;
    WINPR_ASSERT(gdi);
    WINPR_ASSERT(gdi->primary);
    WINPR_ASSERT(gdi->primary->hdc);
    WINPR_ASSERT(gdi->primary->hdc->hwnd);
    WINPR_ASSERT(gdi->primary->hdc->hwnd->invalid);

    gdi->primary->hdc->hwnd->invalid->null = TRUE;
    return TRUE;
}

static BOOL bridge_end_paint(rdpContext* context)
{
    rdpGdi* gdi;
    BridgeContext* bc;
    HGDI_DC hdc;
    HGDI_WND hwnd;
    INT32 x, y, w, h;

    WINPR_ASSERT(context);

    bc = (BridgeContext*)context;
    gdi = context->gdi;
    WINPR_ASSERT(gdi);
    WINPR_ASSERT(gdi->primary);

    hdc = gdi->primary->hdc;
    WINPR_ASSERT(hdc);
    if (!hdc->hwnd)
        return TRUE;

    hwnd = hdc->hwnd;
    if (!hwnd->invalid)
        return TRUE;

    if (hwnd->invalid->null)
        return TRUE;

    /* Extract dirty rectangle */
    x = hwnd->invalid->x;
    y = hwnd->invalid->y;
    w = hwnd->invalid->w;
    h = hwnd->invalid->h;

    /* Clamp to framebuffer bounds */
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > (INT32)gdi->width)  w = gdi->width - x;
    if (y + h > (INT32)gdi->height) h = gdi->height - y;

    if (w <= 0 || h <= 0)
        return TRUE;

    /* Send the entire framebuffer pointer + dirty rect info to Go.
     * Go will extract just the dirty region and JPEG-encode it. */
    goEndPaint(bc->goHandle,
               gdi->primary_buffer, (int)(gdi->stride * gdi->height),
               (int)x, (int)y, (int)w, (int)h,
               (int)gdi->stride);

    return TRUE;
}

static BOOL bridge_desktop_resize(rdpContext* context)
{
    rdpGdi* gdi;
    rdpSettings* settings;

    WINPR_ASSERT(context);

    settings = context->settings;
    WINPR_ASSERT(settings);

    gdi = context->gdi;
    if (!gdi_resize(gdi, freerdp_settings_get_uint32(settings, FreeRDP_DesktopWidth),
                    freerdp_settings_get_uint32(settings, FreeRDP_DesktopHeight)))
        return FALSE;

    return TRUE;
}

/* ============================================
   Channel Event Handlers
   ============================================ */

static void bridge_on_channel_connected(void* context, const ChannelConnectedEventArgs* e)
{
    rdpContext* ctx = (rdpContext*)context;
    WINPR_ASSERT(ctx);
    WINPR_ASSERT(e);

    if (strcmp(e->name, RDPGFX_DVC_CHANNEL_NAME) == 0)
    {
        gdi_graphics_pipeline_init(ctx->gdi, (RdpgfxClientContext*)e->pInterface);
    }
}

static void bridge_on_channel_disconnected(void* context, const ChannelDisconnectedEventArgs* e)
{
    rdpContext* ctx = (rdpContext*)context;
    WINPR_ASSERT(ctx);
    WINPR_ASSERT(e);

    if (strcmp(e->name, RDPGFX_DVC_CHANNEL_NAME) == 0)
    {
        gdi_graphics_pipeline_uninit(ctx->gdi, (RdpgfxClientContext*)e->pInterface);
    }
}

/* ============================================
   Connection Lifecycle Callbacks
   ============================================ */

static BOOL bridge_pre_connect(freerdp* instance)
{
    rdpSettings* settings;

    WINPR_ASSERT(instance);
    WINPR_ASSERT(instance->context);

    settings = instance->context->settings;
    WINPR_ASSERT(settings);

    /* Prefer PEM for certificate callbacks */
    if (!freerdp_settings_set_bool(settings, FreeRDP_CertificateCallbackPreferPEM, TRUE))
        return FALSE;

    /* Auto-accept certificates (for localhost connections) */
    if (!freerdp_settings_set_bool(settings, FreeRDP_AutoAcceptCertificate, TRUE))
        return FALSE;

    /* Register channel handlers for GFX pipeline */
    if (PubSub_SubscribeChannelConnected(instance->context->pubSub,
                                         bridge_on_channel_connected) < 0)
        return FALSE;
    if (PubSub_SubscribeChannelDisconnected(instance->context->pubSub,
                                            bridge_on_channel_disconnected) < 0)
        return FALSE;

    return TRUE;
}

static BOOL bridge_post_connect(freerdp* instance)
{
    rdpContext* context;
    BridgeContext* bc;
    rdpSettings* settings;
    UINT32 w, h;

    WINPR_ASSERT(instance);

    context = instance->context;
    WINPR_ASSERT(context);

    bc = (BridgeContext*)context;

    /* Initialize software GDI with BGRA32 pixel format */
    if (!gdi_init(instance, PIXEL_FORMAT_BGRA32))
        return FALSE;

    /* Register paint callbacks */
    context->update->BeginPaint = bridge_begin_paint;
    context->update->EndPaint = bridge_end_paint;
    context->update->DesktopResize = bridge_desktop_resize;

    /* Notify Go that the connection is ready */
    settings = context->settings;
    w = freerdp_settings_get_uint32(settings, FreeRDP_DesktopWidth);
    h = freerdp_settings_get_uint32(settings, FreeRDP_DesktopHeight);

    bc->desktopReady = 1;
    goOnReady(bc->goHandle, (int)w, (int)h);

    return TRUE;
}

static void bridge_post_disconnect(freerdp* instance)
{
    rdpContext* context;

    if (!instance || !instance->context)
        return;

    context = instance->context;

    PubSub_UnsubscribeChannelConnected(context->pubSub,
                                       bridge_on_channel_connected);
    PubSub_UnsubscribeChannelDisconnected(context->pubSub,
                                          bridge_on_channel_disconnected);
    gdi_free(instance);
}

/* ============================================
   Client Entry Points
   ============================================ */

static BOOL bridge_client_new(freerdp* instance, rdpContext* context)
{
    if (!instance || !context)
        return FALSE;

    instance->PreConnect = bridge_pre_connect;
    instance->PostConnect = bridge_post_connect;
    instance->PostDisconnect = bridge_post_disconnect;

    return TRUE;
}

static void bridge_client_free(freerdp* instance, rdpContext* context)
{
    (void)instance;
    (void)context;
}

static int bridge_client_start(rdpContext* context)
{
    (void)context;
    return 0;
}

static int bridge_client_stop(rdpContext* context)
{
    (void)context;
    return 0;
}

static BOOL bridge_client_global_init(void)
{
    return TRUE;
}

static void bridge_client_global_uninit(void)
{
}

/* ============================================
   Public API
   ============================================ */

rdpContext* bridge_connect(BridgeConnParams* params)
{
    RDP_CLIENT_ENTRY_POINTS ep;
    rdpContext* context;
    rdpSettings* settings;
    BridgeContext* bc;

    if (!params)
        return NULL;

    /* Set up entry points */
    memset(&ep, 0, sizeof(ep));
    ep.Version = RDP_CLIENT_INTERFACE_VERSION;
    ep.Size = sizeof(RDP_CLIENT_ENTRY_POINTS_V1);
    ep.ContextSize = sizeof(BridgeContext);
    ep.GlobalInit = bridge_client_global_init;
    ep.GlobalUninit = bridge_client_global_uninit;
    ep.ClientNew = bridge_client_new;
    ep.ClientFree = bridge_client_free;
    ep.ClientStart = bridge_client_start;
    ep.ClientStop = bridge_client_stop;

    context = freerdp_client_context_new(&ep);
    if (!context)
        return NULL;

    bc = (BridgeContext*)context;
    bc->goHandle = params->goHandle;
    bc->desktopReady = 0;

    settings = context->settings;

    /* Connection target */
    if (!freerdp_settings_set_string(settings, FreeRDP_ServerHostname, params->hostname))
        goto fail;
    if (!freerdp_settings_set_uint32(settings, FreeRDP_ServerPort, params->port))
        goto fail;

    /* Credentials */
    if (!freerdp_settings_set_string(settings, FreeRDP_Username, params->username))
        goto fail;
    if (!freerdp_settings_set_string(settings, FreeRDP_Password, params->password))
        goto fail;
    if (params->domain && params->domain[0] != '\0')
    {
        if (!freerdp_settings_set_string(settings, FreeRDP_Domain, params->domain))
            goto fail;
    }

    /* Display */
    if (!freerdp_settings_set_uint32(settings, FreeRDP_DesktopWidth, params->width))
        goto fail;
    if (!freerdp_settings_set_uint32(settings, FreeRDP_DesktopHeight, params->height))
        goto fail;
    if (!freerdp_settings_set_uint32(settings, FreeRDP_ColorDepth, 32))
        goto fail;

    /* Security: TLS-only, no NLA */
    if (!freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, FALSE))
        goto fail;
    if (!freerdp_settings_set_bool(settings, FreeRDP_TlsSecurity, TRUE))
        goto fail;
    if (!freerdp_settings_set_bool(settings, FreeRDP_RdpSecurity, TRUE))
        goto fail;

    /* Performance flags for streaming */
    if (!freerdp_settings_set_bool(settings, FreeRDP_FastPathOutput, TRUE))
        goto fail;
    if (!freerdp_settings_set_bool(settings, FreeRDP_FrameMarkerCommandEnabled, TRUE))
        goto fail;
    if (!freerdp_settings_set_bool(settings, FreeRDP_SupportGraphicsPipeline, TRUE))
        goto fail;

    /* Actually connect */
    if (!freerdp_connect(context->instance))
    {
        UINT32 err = freerdp_get_last_error(context);
        fprintf(stderr, "bridge_connect: freerdp_connect failed, error 0x%08x\n", err);
        goto fail;
    }

    return context;

fail:
    freerdp_client_context_free(context);
    return NULL;
}

int bridge_run_event_loop(rdpContext* context)
{
    DWORD nCount;
    DWORD status;
    HANDLE handles[MAXIMUM_WAIT_OBJECTS];
    freerdp* instance;

    WINPR_ASSERT(context);
    instance = context->instance;
    WINPR_ASSERT(instance);

    while (!freerdp_shall_disconnect_context(context))
    {
        nCount = freerdp_get_event_handles(context, handles, ARRAYSIZE(handles));
        if (nCount == 0)
        {
            fprintf(stderr, "bridge_run_event_loop: freerdp_get_event_handles failed\n");
            break;
        }

        status = WaitForMultipleObjects(nCount, handles, FALSE, 50);

        if (status == WAIT_FAILED)
        {
            fprintf(stderr, "bridge_run_event_loop: WaitForMultipleObjects failed\n");
            break;
        }

        if (!freerdp_check_event_handles(context))
        {
            UINT32 err = freerdp_get_last_error(context);
            if (err == FREERDP_ERROR_SUCCESS)
                fprintf(stderr, "bridge_run_event_loop: check_event_handles failed (no error)\n");
            break;
        }
    }

    /* Notify Go */
    {
        BridgeContext* bc = (BridgeContext*)context;
        UINT32 err = freerdp_get_last_error(context);
        goOnDisconnect(bc->goHandle, (int)err);
    }

    return 0;
}

void bridge_disconnect(rdpContext* context)
{
    if (!context || !context->instance)
        return;

    freerdp_abort_connect_context(context);
    freerdp_disconnect(context->instance);
}

void bridge_free(rdpContext* context)
{
    if (!context)
        return;
    freerdp_client_context_free(context);
}

void bridge_send_keyboard(rdpContext* context, uint16_t flags, uint16_t code)
{
    if (!context || !context->input)
        return;
    freerdp_input_send_keyboard_event(context->input, flags, code);
}

void bridge_send_mouse(rdpContext* context, uint16_t flags, uint16_t x, uint16_t y)
{
    if (!context || !context->input)
        return;
    freerdp_input_send_mouse_event(context->input, flags, x, y);
}
