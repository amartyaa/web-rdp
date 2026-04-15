/**
 * VCollab Web RDP — Client Application
 *
 * Handles: WebSocket lifecycle, authentication, canvas rendering,
 * keyboard/mouse event capture and forwarding.
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
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const resolutionText = document.getElementById('resolution-text');
    const disconnectBtn = document.getElementById('disconnect-btn');

    // ========================================
    // State
    // ========================================

    let ws = null;
    let connected = false;
    let remoteWidth = 1920;
    let remoteHeight = 1080;

    // ========================================
    // Scancode Mapping (event.code → AT-101 scancode)
    // ========================================

    const SCANCODE_MAP = {
        'Escape': 0x01, 'Digit1': 0x02, 'Digit2': 0x03, 'Digit3': 0x04,
        'Digit4': 0x05, 'Digit5': 0x06, 'Digit6': 0x07, 'Digit7': 0x08,
        'Digit8': 0x09, 'Digit9': 0x0A, 'Digit0': 0x0B, 'Minus': 0x0C,
        'Equal': 0x0D, 'Backspace': 0x0E, 'Tab': 0x09,
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
            // Send the browser's available viewport dimensions so RDP matches
            const wrapper = document.querySelector('.canvas-wrapper');
            const statusBar = document.getElementById('status-bar');
            const availW = wrapper ? wrapper.clientWidth : window.innerWidth;
            const availH = wrapper ? wrapper.clientHeight : (window.innerHeight - (statusBar ? statusBar.offsetHeight : 30));
            // Round to even for codec compatibility
            const reqW = Math.floor(availW / 2) * 2;
            const reqH = Math.floor(availH / 2) * 2;

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
    // Frame Rendering
    // ========================================

    function handleFrame(buffer) {
        // Binary frame format: [2B x][2B y][2B w][2B h][JPEG payload]
        // All uint16 little-endian
        const header = new DataView(buffer, 0, 8);
        const x = header.getUint16(0, true);
        const y = header.getUint16(2, true);
        const w = header.getUint16(4, true);
        const h = header.getUint16(6, true);
        const jpegData = new Uint8Array(buffer, 8);

        const blob = new Blob([jpegData], { type: 'image/jpeg' });
        createImageBitmap(blob).then(function (bitmap) {
            ctx.drawImage(bitmap, x, y, w, h);
            bitmap.close();
        }).catch(function (err) {
            console.error('Frame decode error:', err);
        });
    }

    // ========================================
    // Input Handling — Keyboard
    // ========================================

    function handleKeyEvent(event, isDown) {
        if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;

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
    // Input Handling — Mouse
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

        connectWebSocket(username, password, domain);
    });

    // Disconnect button
    disconnectBtn.addEventListener('click', function () {
        handleDisconnect('User disconnected');
    });

    // Canvas keyboard events
    canvas.addEventListener('keydown', function (e) { handleKeyEvent(e, true); });
    canvas.addEventListener('keyup', function (e) { handleKeyEvent(e, false); });

    // Canvas mouse events
    canvas.addEventListener('mousemove', function (e) {
        sendMouse(PTR_FLAGS_MOVE, e);
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
