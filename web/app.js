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
    const resolutionSelect = document.getElementById('resolution-selector');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const fpsToggleBtn = document.getElementById('fps-toggle-btn');
    const fpsOverlay = document.getElementById('fps-overlay');
    const fpsText = document.getElementById('fps-text');

    // ========================================
    // State
    // ========================================

    let ws = null;
    let connected = false;
    let remoteWidth = 1920;
    let remoteHeight = 1080;

    // Credentials for auto-reconnect on resolution change
    let currentUsername = '';
    let currentPassword = '';
    let currentDomain = '';

    // Fullscreen
    let isFullscreen = false;
    let toolbarTimeout = null;

    // Mouse throttling
    let lastMouseSendTime = 0;
    const MOUSE_THROTTLE_MS = 16; // ~60 events/sec

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
            // Resolution parsing
            const resVal = resolutionSelect ? resolutionSelect.value : 'auto';
            let reqW = 1920;
            let reqH = 1080;
            
            if (resVal === 'auto') {
                reqW = Math.floor(window.innerWidth / 2) * 2;
                // roughly account for status bar height if visible and not fullscreen
                const statusHeight = isFullscreen ? 0 : (statusBar ? statusBar.offsetHeight : 30);
                reqH = Math.floor((window.innerHeight - statusHeight) / 2) * 2;
            } else {
                const parts = resVal.split('x');
                reqW = parseInt(parts[0], 10);
                reqH = parseInt(parts[1], 10);
            }

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
        
        // Sync select value if server forced a resolution not matching expectation
        if (resolutionSelect.value !== 'auto') {
            const expected = remoteWidth + 'x' + remoteHeight;
            let optionExists = false;
            for (let i=0; i<resolutionSelect.options.length; i++) {
                if(resolutionSelect.options[i].value === expected) { optionExists = true; break;}
            }
            if(!optionExists) {
                const opt = document.createElement('option');
                opt.value = expected;
                opt.innerHTML = remoteWidth + '×' + remoteHeight;
                resolutionSelect.appendChild(opt);
            }
            resolutionSelect.value = expected;
        }

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
    }

    // ========================================
    // H.264 WebCodecs Decoder
    // ========================================

    function initH264Decoder() {
        if (!webCodecsSupported) return;

        try {
            h264Decoder = new VideoDecoder({
                output: function (frame) {
                    // Draw the decoded video frame on canvas
                    ctx.drawImage(frame, 0, 0, remoteWidth, remoteHeight);
                    frame.close();
                },
                error: function (err) {
                    console.error('H.264 decode error:', err);
                    // Fall back to JPEG-only mode
                    h264Decoder = null;
                }
            });

            // Configure for H.264 Baseline Profile
            h264Decoder.configure({
                codec: 'avc1.42E01E', // Baseline Level 3.0
                optimizeForLatency: true,
            });

            console.log('WebCodecs H.264 decoder initialized');
        } catch (e) {
            console.warn('WebCodecs not available, using JPEG fallback:', e);
            h264Decoder = null;
        }
    }

    function cleanupH264Decoder() {
        if (h264Decoder) {
            try { h264Decoder.close(); } catch(e) { /* ignore */ }
            h264Decoder = null;
        }
    }

    // ========================================
    // Frame Rendering (with rAF batching)
    // ========================================

    function handleFrame(buffer) {
        frameCount++;

        // Check header format: new 9-byte header with type, or legacy 8-byte
        var headerSize, frameType;
        var view = new DataView(buffer);

        if (buffer.byteLength > 9) {
            // New format: [1B type][2B x][2B y][2B w][2B h][payload]
            frameType = view.getUint8(0);
            headerSize = 9;
            if (frameType !== FRAME_TYPE_JPEG && frameType !== FRAME_TYPE_H264) {
                // Legacy 8-byte format (type byte looks like high byte of x coordinate)
                frameType = FRAME_TYPE_JPEG;
                headerSize = 8;
            }
        } else {
            // Legacy 8-byte format
            frameType = FRAME_TYPE_JPEG;
            headerSize = 8;
        }

        if (frameType === FRAME_TYPE_H264 && h264Decoder && h264Decoder.state === 'configured') {
            // H.264 passthrough: decode via WebCodecs GPU
            var h264Data = new Uint8Array(buffer, headerSize);
            try {
                var chunk = new EncodedVideoChunk({
                    type: 'key', // Treat all as keyframes for simplicity; real impl checks NAL type
                    timestamp: performance.now() * 1000,
                    data: h264Data
                });
                h264Decoder.decode(chunk);
            } catch (e) {
                console.error('H.264 chunk error:', e);
            }
            return;
        }

        // Direct image processing (no requestAnimationFrame batching to avoid stutter/tearing)
        var offset = (headerSize === 9) ? 1 : 0;
        var x = view.getUint16(offset, true);
        var y = view.getUint16(offset + 2, true);
        var w = view.getUint16(offset + 4, true);
        var h = view.getUint16(offset + 6, true);
        var jpegData = new Uint8Array(buffer, headerSize);

        var blob = new Blob([jpegData], { type: 'image/jpeg' });
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function() {
            ctx.drawImage(img, x, y, w, h);
            URL.revokeObjectURL(url);
        };
        img.onerror = function() {
            URL.revokeObjectURL(url);
        }
        img.src = url;
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
            setLoading(false); // Prevent stuck spinner on disconnect
            if (reason && reason !== 'reconnect') {
                showError('Disconnected: ' + reason);
            }
        }, reason === 'reconnect' ? 0 : 1000);
    }

    // ========================================
    // Event Listeners
    // ========================================

    // Login form submit
    loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        hideError();
        setLoading(true);

        currentUsername = usernameInput.value.trim();
        currentPassword = passwordInput.value;
        currentDomain = domainInput.value.trim();

        if (!currentUsername || !currentPassword) {
            showError('Username and password are required');
            setLoading(false);
            return;
        }

        connectWebSocket(currentUsername, currentPassword, currentDomain);
    });

    // Resolution change dynamically
    if (resolutionSelect) {
        resolutionSelect.addEventListener('change', function() {
            if (connected) {
                handleDisconnect('reconnect');
                // Brief delay to ensure disconnect completes then reconnect
                setTimeout(function() {
                     setLoading(true);
                     connectWebSocket(currentUsername, currentPassword, currentDomain);
                }, 100);
            }
        });
    }

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
