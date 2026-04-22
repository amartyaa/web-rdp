/**
 * VCollab Web RDP — Client Application
 *
 * Handles: WebSocket lifecycle, authentication, canvas rendering,
 * keyboard/mouse event capture and forwarding.
 * Phase 2: FPS counter, fullscreen, keyboard shortcuts, rAF batching,
 * mouse throttling, H.264 WebCodecs support.
 */

(function () {
    'use strict';

    // ========================================
    // DOM References
    // ========================================

    const loginScreen = document.getElementById('login-screen');
    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const domainInput = document.getElementById('domain');
    const connectBtn = document.getElementById('connect-btn');
    const btnText = connectBtn.querySelector('.btn-text');
    const btnSpinner = connectBtn.querySelector('.btn-spinner');
    const loginError = document.getElementById('login-error');

    const rdpScreen = document.getElementById('rdp-screen');
    const canvas = document.getElementById('rdp-canvas');
    const ctx = canvas.getContext('2d');
    const statusBar = document.getElementById('status-bar');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const resolutionText = document.getElementById('resolution-text');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const fpsToggleBtn = document.getElementById('fps-toggle-btn');
    const fpsOverlay = document.getElementById('fps-overlay');
    const fpsText = document.getElementById('fps-text');
    const qualityToggleBtn = document.getElementById('quality-toggle-btn');
    const qualityPopup = document.getElementById('quality-popup');
    const qualitySlider = document.getElementById('quality-slider');
    const qualityValue = document.getElementById('quality-value');
    const clipboardBtn = document.getElementById('clipboard-btn');
    const altTabBtn = document.getElementById('alttab-btn');
    const cadBtn = document.getElementById('cad-btn');
    const fullscreenConnectCb = document.getElementById('fullscreen-connect');
    const codecIndicator = document.getElementById('codec-indicator');

    // ========================================
    // State
    // ========================================

    let ws = null;
    let connected = false;
    let remoteWidth = 1920;
    let remoteHeight = 1080;

    // FPS tracking
    let frameCount = 0;
    let fpsVisible = false;
    let fpsInterval = null;

    // Fullscreen
    let isFullscreen = false;
    let toolbarTimeout = null;

    // Mouse throttling
    let lastMouseSendTime = 0;
    const MOUSE_THROTTLE_MS = 16; // ~60 events/sec

    // Codec tracking
    let h264FrameCount = 0;
    let jpegFrameCount = 0;
    let pngFrameCount = 0;
    let codecLogged = false;

    // H.264 WebCodecs
    let h264Decoder = null;
    let webCodecsSupported = (typeof VideoDecoder !== 'undefined');

    // ========================================
    // Scancode Mapping (event.code → AT-101 scancode)
    // ========================================

    const SCANCODE_MAP = {
        'Escape': 0x01, 'Digit1': 0x02, 'Digit2': 0x03, 'Digit3': 0x04,
        'Digit4': 0x05, 'Digit5': 0x06, 'Digit6': 0x07, 'Digit7': 0x08,
        'Digit8': 0x09, 'Digit9': 0x0A, 'Digit0': 0x0B, 'Minus': 0x0C,
        'Equal': 0x0D, 'Backspace': 0x0E, 'Tab': 0x0F,
        'KeyQ': 0x10, 'KeyW': 0x11, 'KeyE': 0x12, 'KeyR': 0x13,
        'KeyT': 0x14, 'KeyY': 0x15, 'KeyU': 0x16, 'KeyI': 0x17,
        'KeyO': 0x18, 'KeyP': 0x19, 'BracketLeft': 0x1A, 'BracketRight': 0x1B,
        'Enter': 0x1C, 'ControlLeft': 0x1D,
        'KeyA': 0x1E, 'KeyS': 0x1F, 'KeyD': 0x20, 'KeyF': 0x21,
        'KeyG': 0x22, 'KeyH': 0x23, 'KeyJ': 0x24, 'KeyK': 0x25,
        'KeyL': 0x26, 'Semicolon': 0x27, 'Quote': 0x28, 'Backquote': 0x29,
        'ShiftLeft': 0x2A, 'Backslash': 0x2B,
        'KeyZ': 0x2C, 'KeyX': 0x2D, 'KeyC': 0x2E, 'KeyV': 0x2F,
        'KeyB': 0x30, 'KeyN': 0x31, 'KeyM': 0x32, 'Comma': 0x33,
        'Period': 0x34, 'Slash': 0x35, 'ShiftRight': 0x36,
        'NumpadMultiply': 0x37, 'AltLeft': 0x38, 'Space': 0x39,
        'CapsLock': 0x3A,
        'F1': 0x3B, 'F2': 0x3C, 'F3': 0x3D, 'F4': 0x3E,
        'F5': 0x3F, 'F6': 0x40, 'F7': 0x41, 'F8': 0x42,
        'F9': 0x43, 'F10': 0x44, 'NumLock': 0x45, 'ScrollLock': 0x46,
        'Numpad7': 0x47, 'Numpad8': 0x48, 'Numpad9': 0x49, 'NumpadSubtract': 0x4A,
        'Numpad4': 0x4B, 'Numpad5': 0x4C, 'Numpad6': 0x4D, 'NumpadAdd': 0x4E,
        'Numpad1': 0x4F, 'Numpad2': 0x50, 'Numpad3': 0x51,
        'Numpad0': 0x52, 'NumpadDecimal': 0x53,
        'F11': 0x57, 'F12': 0x58,
    };

    // Extended keys that require KBDFLAGS_EXTENDED (0x0100)
    const EXTENDED_KEYS = new Set([
        'ControlRight', 'AltRight', 'NumpadEnter', 'NumpadDivide',
        'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'MetaLeft', 'MetaRight', 'ContextMenu',
    ]);

    const EXTENDED_SCANCODE_MAP = {
        'ControlRight': 0x1D, 'AltRight': 0x38,
        'NumpadEnter': 0x1C, 'NumpadDivide': 0x35,
        'Insert': 0x52, 'Delete': 0x53, 'Home': 0x47, 'End': 0x4F,
        'PageUp': 0x49, 'PageDown': 0x51,
        'ArrowUp': 0x48, 'ArrowDown': 0x50, 'ArrowLeft': 0x4B, 'ArrowRight': 0x4D,
        'MetaLeft': 0x5B, 'MetaRight': 0x5C, 'ContextMenu': 0x5D,
    };

    // RDP Mouse Flags
    const PTR_FLAGS_MOVE    = 0x0800;
    const PTR_FLAGS_DOWN    = 0x8000;
    const PTR_FLAGS_BUTTON1 = 0x1000; // Left
    const PTR_FLAGS_BUTTON2 = 0x2000; // Right
    const PTR_FLAGS_BUTTON3 = 0x4000; // Middle
    const PTR_FLAGS_WHEEL   = 0x0200;
    const PTR_FLAGS_WHEEL_NEGATIVE = 0x0100;

    // Keyboard Flags
    const KBD_FLAGS_RELEASE  = 0x8000;
    const KBD_FLAGS_EXTENDED = 0x0100;

    // Frame type constants
    const FRAME_TYPE_JPEG = 0x00;
    const FRAME_TYPE_H264 = 0x01;
    const FRAME_TYPE_PNG  = 0x02;

    // ========================================
    // WebSocket
    // ========================================

    function getWsUrl() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Derive WS path from current page URL
        let path = location.pathname;
        if (!path.endsWith('/')) path += '/';
        return proto + '//' + location.host + path + 'ws';
    }

    function connectWebSocket(username, password, domain) {
        const url = getWsUrl();
        console.log('Connecting to', url);
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';

        ws.onopen = function () {
            console.log('WebSocket connected');
            // Use window dimensions — the canvas-wrapper is hidden at this point
            // so its clientWidth/Height would be 0. Subtract estimated status bar.
            var availW = window.innerWidth;
            var availH = window.innerHeight - 30;
            // Round to even for codec compatibility
            var reqW = Math.floor(availW / 2) * 2;
            var reqH = Math.floor(availH / 2) * 2;

            ws.send(JSON.stringify({
                type: 'auth',
                username: username,
                password: password,
                domain: domain || '',
                width: reqW,
                height: reqH
            }));
        };

        ws.onmessage = function (event) {
            if (event.data instanceof ArrayBuffer) {
                handleFrame(event.data);
            } else {
                handleJsonMessage(JSON.parse(event.data));
            }
        };

        ws.onerror = function (err) {
            console.error('WebSocket error:', err);
        };

        ws.onclose = function (event) {
            console.log('WebSocket closed:', event.code, event.reason);
            handleDisconnect(event.reason || 'Connection closed');
        };
    }

    function handleJsonMessage(msg) {
        switch (msg.type) {
            case 'auth_ok':
                onAuthSuccess(msg.width, msg.height);
                break;
            case 'auth_fail':
                onAuthFail(msg.error);
                break;
            case 'resize':
                onResize(msg.width, msg.height);
                break;
            case 'error':
                showError(msg.message);
                handleDisconnect(msg.message);
                break;
        }
    }

    // ========================================
    // Authentication
    // ========================================

    function onAuthSuccess(width, height) {
        connected = true;
        remoteWidth = width || 1920;
        remoteHeight = height || 1080;

        // Set canvas to remote resolution
        canvas.width = remoteWidth;
        canvas.height = remoteHeight;
        resolutionText.textContent = remoteWidth + '×' + remoteHeight;

        // Initialize H.264 decoder if supported
        if (webCodecsSupported) {
            initH264Decoder();
        }

        // Start FPS counter
        startFpsCounter();

        // Transition to RDP screen
        loginScreen.classList.add('hiding');
        setTimeout(function () {
            loginScreen.hidden = true;
            rdpScreen.hidden = false;
            canvas.focus();
            setStatus('connected', 'Connected');
        }, 400);

        resetLoginForm();
    }

    function onAuthFail(error) {
        showError(error || 'Authentication failed');
        resetLoginForm();
        if (ws) {
            ws.close();
            ws = null;
        }
    }

    function onResize(width, height) {
        remoteWidth = width;
        remoteHeight = height;
        canvas.width = remoteWidth;
        canvas.height = remoteHeight;
        resolutionText.textContent = remoteWidth + '×' + remoteHeight;
    }

    // ========================================
    // H.264 WebCodecs Decoder
    // ========================================

    // Pending H.264 region info (set before decode, read by output callback)
    let h264PendingRegions = [];

    function initH264Decoder() {
        if (!webCodecsSupported) return;

        try {
            h264Decoder = new VideoDecoder({
                output: function (frame) {
                    // Draw the decoded video frame at the correct dirty-rect position
                    var region = h264PendingRegions.shift();
                    if (region) {
                        ctx.drawImage(frame, region.x, region.y, region.w, region.h);
                    } else {
                        // Fallback: if no region info, draw at origin
                        ctx.drawImage(frame, 0, 0);
                    }
                    frame.close();
                },
                error: function (err) {
                    console.error('H.264 decode error:', err);
                    // Fall back to JPEG/PNG mode
                    h264Decoder = null;
                    h264PendingRegions = [];
                }
            });

            // Configure for H.264 Constrained Baseline (what RDP AVC420 uses)
            h264Decoder.configure({
                codec: 'avc1.42C01E', // Constrained Baseline Level 3.0
                optimizeForLatency: true,
            });

            console.log('WebCodecs H.264 decoder initialized');
        } catch (e) {
            console.warn('WebCodecs not available, using JPEG/PNG fallback:', e);
            h264Decoder = null;
        }
    }

    function cleanupH264Decoder() {
        if (h264Decoder) {
            try { h264Decoder.close(); } catch(e) { /* ignore */ }
            h264Decoder = null;
        }
        h264PendingRegions = [];
    }

    // ========================================
    // Frame Rendering
    // ========================================

    var decodePromise = Promise.resolve();

    function handleFrame(buffer) {
        frameCount++;

        // Wire format: [1B type][2B x][2B y][2B w][2B h][payload] (9-byte header)
        if (buffer.byteLength <= 9) return;

        var view = new DataView(buffer);
        var frameType = view.getUint8(0);
        var x = view.getUint16(1, true);
        var y = view.getUint16(3, true);
        var w = view.getUint16(5, true);
        var h = view.getUint16(7, true);

        if (frameType === FRAME_TYPE_H264 && h264Decoder && h264Decoder.state === 'configured') {
            h264FrameCount++;
            if (h264FrameCount === 1) {
                console.log('%c[CODEC] First H.264 frame received — GPU-accelerated decode active', 'color: #22c55e; font-weight: bold');
                updateCodecIndicator();
            }
            var h264Data = new Uint8Array(buffer, 9);
            try {
                // Queue region info so the output callback knows where to draw
                h264PendingRegions.push({ x: x, y: y, w: w, h: h });

                var chunk = new EncodedVideoChunk({
                    type: 'key',
                    timestamp: performance.now() * 1000,
                    data: h264Data
                });
                h264Decoder.decode(chunk);
            } catch (e) {
                console.error('H.264 chunk error:', e);
                h264PendingRegions.pop(); // remove the queued region on error
            }
            return;
        }

        // Track JPEG/PNG frames
        if (frameType === FRAME_TYPE_PNG) {
            pngFrameCount++;
            if (pngFrameCount === 1) {
                console.log('%c[CODEC] First PNG frame received — lossless mode', 'color: #3b82f6; font-weight: bold');
                updateCodecIndicator();
            }
        } else {
            jpegFrameCount++;
            if (jpegFrameCount === 1) {
                console.log('%c[CODEC] First JPEG frame received — lossy mode', 'color: #f59e0b; font-weight: bold');
                updateCodecIndicator();
            }
        }

        // Image path (JPEG or PNG): decode and draw sequentially
        var imageData = new Uint8Array(buffer, 9);
        var mimeType = (frameType === FRAME_TYPE_PNG) ? 'image/png' : 'image/jpeg';
        
        decodePromise = decodePromise.then(function() {
            var blob = new Blob([imageData], { type: mimeType });
            return createImageBitmap(blob);
        }).then(function (bitmap) {
            ctx.drawImage(bitmap, x, y, w, h);
            bitmap.close();
        }).catch(function (err) {
            console.error('Frame decode error:', err);
        });
    }

    // ========================================
    // FPS Counter
    // ========================================

    function startFpsCounter() {
        frameCount = 0;
        if (fpsInterval) clearInterval(fpsInterval);
        fpsInterval = setInterval(function () {
            if (fpsVisible) {
                fpsText.textContent = frameCount + ' FPS';
            }
            frameCount = 0;
        }, 1000);
    }

    function stopFpsCounter() {
        if (fpsInterval) {
            clearInterval(fpsInterval);
            fpsInterval = null;
        }
    }

    function toggleFps() {
        fpsVisible = !fpsVisible;
        fpsOverlay.hidden = !fpsVisible;
        fpsToggleBtn.classList.toggle('active', fpsVisible);
    }

    // ========================================
    // Fullscreen
    // ========================================

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            rdpScreen.requestFullscreen().catch(function (e) {
                console.warn('Fullscreen failed:', e);
            });
        } else {
            document.exitFullscreen();
        }
    }

    function updateCodecIndicator() {
        if (!codecIndicator) return;
        codecIndicator.hidden = false;
        codecIndicator.className = 'codec-badge';

        if (h264FrameCount > 0) {
            codecIndicator.textContent = 'H.264';
            codecIndicator.classList.add('codec-h264');
        } else if (pngFrameCount > 0 && jpegFrameCount === 0) {
            codecIndicator.textContent = 'PNG';
            codecIndicator.classList.add('codec-png');
        } else if (jpegFrameCount > 0) {
            codecIndicator.textContent = 'JPEG';
            codecIndicator.classList.add('codec-jpeg');
        }
    }

    function resetCodecCounters() {
        h264FrameCount = 0;
        jpegFrameCount = 0;
        pngFrameCount = 0;
        codecLogged = false;
        if (codecIndicator) {
            codecIndicator.hidden = true;
            codecIndicator.textContent = '';
            codecIndicator.className = 'codec-badge';
        }
    }

    function onFullscreenChange() {
        isFullscreen = !!document.fullscreenElement;
        rdpScreen.classList.toggle('is-fullscreen', isFullscreen);
        if (isFullscreen) {
            showToolbarTemporarily();
        } else {
            clearTimeout(toolbarTimeout);
            statusBar.classList.remove('toolbar-visible');
        }
        canvas.focus();
    }

    function showToolbarTemporarily() {
        statusBar.classList.add('toolbar-visible');
        clearTimeout(toolbarTimeout);
        toolbarTimeout = setTimeout(function () {
            statusBar.classList.remove('toolbar-visible');
        }, 3000);
    }

    // ========================================
    // Input Handling — Keyboard
    // ========================================

    function handleKeyEvent(event, isDown) {
        if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;

        // Intercept app keyboard shortcuts (Ctrl+Shift+Key)
        if (event.ctrlKey && event.shiftKey) {
            if (isDown) {
                switch (event.code) {
                    case 'KeyF':
                        event.preventDefault();
                        toggleFullscreen();
                        return;
                    case 'KeyD':
                        event.preventDefault();
                        handleDisconnect('User disconnected');
                        return;
                    case 'KeyP':
                        event.preventDefault();
                        toggleFps();
                        return;
                }
            } else {
                // Suppress keyup for consumed shortcuts
                if (event.code === 'KeyF' || event.code === 'KeyD' || event.code === 'KeyP') {
                    event.preventDefault();
                    return;
                }
            }
        }

        // Ctrl+Tab → send Alt+Tab to remote (browser can't send native Alt+Tab)
        if (event.ctrlKey && event.code === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            if (isDown) {
                sendKeyCombo([
                    { code: 0x38, flags: 0 },         // Alt down
                    { code: 0x0F, flags: 0 },         // Tab down
                    { code: 0x0F, flags: KBD_FLAGS_RELEASE }, // Tab up
                    { code: 0x38, flags: KBD_FLAGS_RELEASE }, // Alt up
                ]);
            }
            return;
        }

        let scancode;
        let flags = isDown ? 0 : KBD_FLAGS_RELEASE;

        if (EXTENDED_KEYS.has(event.code)) {
            scancode = EXTENDED_SCANCODE_MAP[event.code];
            flags |= KBD_FLAGS_EXTENDED;
        } else {
            scancode = SCANCODE_MAP[event.code];
        }

        if (scancode === undefined) return;

        event.preventDefault();
        event.stopPropagation();

        ws.send(JSON.stringify({
            type: 'key',
            code: scancode,
            flags: flags
        }));
    }
    // ========================================
    // Special Key Combos & Text Input
    // ========================================

    // Send a sequence of key events with 30ms spacing
    function sendKeyCombo(keys) {
        if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
        keys.forEach(function (k, i) {
            setTimeout(function () {
                ws.send(JSON.stringify({ type: 'key', code: k.code, flags: k.flags }));
            }, i * 30);
        });
    }

    // Send raw text to the server to be injected via Unicode keyboard events
    function sendUnicodeText(text) {
        if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'clipboard', text: text }));
    }

    // ========================================
    // Input Handling — Mouse (with throttling)
    // ========================================

    function getCanvasCoords(event) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = remoteWidth / rect.width;
        const scaleY = remoteHeight / rect.height;
        return {
            x: Math.round((event.clientX - rect.left) * scaleX),
            y: Math.round((event.clientY - rect.top) * scaleY)
        };
    }

    function sendMouse(flags, event) {
        if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
        const pos = getCanvasCoords(event);
        ws.send(JSON.stringify({
            type: 'mouse',
            x: Math.max(0, Math.min(pos.x, remoteWidth - 1)),
            y: Math.max(0, Math.min(pos.y, remoteHeight - 1)),
            flags: flags
        }));
    }

    function sendMouseThrottled(flags, event) {
        var now = performance.now();
        if (now - lastMouseSendTime < MOUSE_THROTTLE_MS) return;
        lastMouseSendTime = now;
        sendMouse(flags, event);
    }

    function buttonToFlag(button) {
        switch (button) {
            case 0: return PTR_FLAGS_BUTTON1;
            case 1: return PTR_FLAGS_BUTTON3;
            case 2: return PTR_FLAGS_BUTTON2;
            default: return 0;
        }
    }

    // ========================================
    // UI Helpers
    // ========================================

    function setStatus(state, text) {
        statusDot.className = 'status-dot ' + state;
        statusText.textContent = text;
    }

    function showError(message) {
        loginError.textContent = message;
        loginError.hidden = false;
    }

    function hideError() {
        loginError.hidden = true;
        loginError.textContent = '';
    }

    function setLoading(loading) {
        connectBtn.disabled = loading;
        btnText.textContent = loading ? 'Connecting…' : 'Connect';
        btnSpinner.hidden = !loading;
    }

    function resetLoginForm() {
        setLoading(false);
        passwordInput.value = '';
    }

    function handleDisconnect(reason) {
        connected = false;
        console.log('[CODEC] Session stats — H.264: ' + h264FrameCount + ', JPEG: ' + jpegFrameCount + ', PNG: ' + pngFrameCount);
        resetCodecCounters();
        if (ws) {
            ws.close();
            ws = null;
        }

        cleanupH264Decoder();
        stopFpsCounter();

        // Exit fullscreen if active
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(function() {});
        }

        setStatus('disconnected', 'Disconnected');
        // Show login screen after a brief delay
        setTimeout(function () {
            rdpScreen.hidden = true;
            loginScreen.hidden = false;
            loginScreen.classList.remove('hiding');
            if (reason) {
                showError('Disconnected: ' + reason);
            }
        }, 1000);
    }

    // ========================================
    // Event Listeners
    // ========================================

    // Login form submit
    loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        hideError();
        setLoading(true);

        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const domain = domainInput.value.trim();

        if (!username || !password) {
            showError('Username and password are required');
            setLoading(false);
            return;
        }

        // Enter fullscreen before connecting if checkbox is checked
        if (fullscreenConnectCb && fullscreenConnectCb.checked && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().then(function () {
                // Small delay to let the browser update screen dimensions
                setTimeout(function () {
                    connectWebSocket(username, password, domain);
                }, 200);
            }).catch(function () {
                // Fullscreen denied — connect anyway
                connectWebSocket(username, password, domain);
            });
        } else {
            connectWebSocket(username, password, domain);
        }
    });

    // Disconnect button
    disconnectBtn.addEventListener('click', function () {
        handleDisconnect('User disconnected');
    });

    // Fullscreen button
    fullscreenBtn.addEventListener('click', function () {
        toggleFullscreen();
        canvas.focus();
    });

    // FPS toggle button
    fpsToggleBtn.addEventListener('click', function () {
        toggleFps();
        canvas.focus();
    });

    // Quality slider toggle
    qualityToggleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var visible = !qualityPopup.hidden;
        qualityPopup.hidden = visible;
        qualityToggleBtn.classList.toggle('active', !visible);
    });

    qualitySlider.addEventListener('input', function () {
        var q = parseInt(qualitySlider.value, 10);
        qualityValue.textContent = q >= 95 ? q + ' (Lossless)' : q;
    });

    qualitySlider.addEventListener('change', function () {
        var q = parseInt(qualitySlider.value, 10);
        qualityValue.textContent = q;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'settings', quality: q }));
        }
    });

    // Prevent slider interaction from stealing canvas focus
    qualitySlider.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    // Close quality popup on outside click
    document.addEventListener('click', function (e) {
        if (!qualityPopup.hidden && !qualityPopup.contains(e.target) && e.target !== qualityToggleBtn) {
            qualityPopup.hidden = true;
            qualityToggleBtn.classList.remove('active');
        }
    });

    // Clipboard paste button
    clipboardBtn.addEventListener('click', function () {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            console.warn('Clipboard API not available');
            canvas.focus();
            return;
        }
        navigator.clipboard.readText().then(function (text) {
            if (text && connected) {
                sendUnicodeText(text);
            }
            canvas.focus();
        }).catch(function (err) {
            console.warn('Clipboard read failed:', err);
            canvas.focus();
        });
    });

    // Global paste event (Ctrl+V)
    document.addEventListener('paste', function (e) {
        if (!connected) return;
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (text) {
            e.preventDefault();
            sendUnicodeText(text);
        }
    });

    // Alt+Tab button
    altTabBtn.addEventListener('click', function () {
        sendKeyCombo([
            { code: 0x38, flags: 0 },         // Alt down
            { code: 0x0F, flags: 0 },         // Tab down
            { code: 0x0F, flags: KBD_FLAGS_RELEASE }, // Tab up
            { code: 0x38, flags: KBD_FLAGS_RELEASE }, // Alt up
        ]);
        canvas.focus();
    });

    // Ctrl+Alt+Del button
    cadBtn.addEventListener('click', function () {
        sendKeyCombo([
            { code: 0x1D, flags: 0 },         // Ctrl down
            { code: 0x38, flags: 0 },         // Alt down
            { code: 0x53, flags: KBD_FLAGS_EXTENDED },              // Del down (extended)
            { code: 0x53, flags: KBD_FLAGS_RELEASE | KBD_FLAGS_EXTENDED }, // Del up
            { code: 0x38, flags: KBD_FLAGS_RELEASE }, // Alt up
            { code: 0x1D, flags: KBD_FLAGS_RELEASE }, // Ctrl up
        ]);
        canvas.focus();
    });

    // Fullscreen change event
    document.addEventListener('fullscreenchange', onFullscreenChange);

    // Auto-show toolbar when mouse near bottom in fullscreen
    document.addEventListener('mousemove', function (e) {
        if (isFullscreen && connected) {
            var h = window.innerHeight;
            if (e.clientY > h - 50) {
                showToolbarTemporarily();
            }
        }
    });

    // Canvas keyboard events
    canvas.addEventListener('keydown', function (e) { handleKeyEvent(e, true); });
    canvas.addEventListener('keyup', function (e) { handleKeyEvent(e, false); });

    // Canvas mouse events (with throttling for mousemove)
    canvas.addEventListener('mousemove', function (e) {
        sendMouseThrottled(PTR_FLAGS_MOVE, e);
    });

    canvas.addEventListener('mousedown', function (e) {
        e.preventDefault();
        canvas.focus();
        const flag = buttonToFlag(e.button);
        if (flag) sendMouse(PTR_FLAGS_DOWN | flag, e);
    });

    canvas.addEventListener('mouseup', function (e) {
        e.preventDefault();
        const flag = buttonToFlag(e.button);
        if (flag) sendMouse(flag, e);
    });

    canvas.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });

    canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        let flags = PTR_FLAGS_WHEEL;
        let delta = Math.round(-e.deltaY / 4);

        if (delta < 0) {
            flags |= PTR_FLAGS_WHEEL_NEGATIVE;
            delta = -delta;
        }
        // Clamp to 0-255 (RDP wheel delta is 9 bits with sign)
        delta = Math.min(delta, 0xFF);
        flags |= delta;

        sendMouse(flags, e);
    }, { passive: false });

    // Prevent losing focus
    canvas.addEventListener('blur', function () {
        if (connected) {
            setTimeout(function () { canvas.focus(); }, 100);
        }
    });

    // Focus username on load
    usernameInput.focus();

})();
