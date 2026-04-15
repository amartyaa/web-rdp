# VCollab Web RDP

A lightweight, self-hosted web-based RDP client. This Go application runs as an agent on the target machine, serves an HTML5 Canvas UI, and proxies browser interactions to the local RDP service (`localhost:3389`) via [FreeRDP v3](https://www.freerdp.com/).

> **Conceptually similar to [noVNC](https://novnc.com/), but for RDP.**

---

## Features (Phase 1)

- 🖥️ **Remote desktop in the browser** — HTML5 Canvas rendering, no plugins
- 🔐 **Credential-based auth** — username/password/domain sent securely over WebSocket
- ⌨️ **Keyboard & mouse** — full AT-101 scancode mapping, click/drag/scroll
- 🎯 **1:1 deployment** — always targets `localhost:3389`, no routing complexity
- 📦 **Single directory distribution** — binary + shared libraries, no install needed
- 🔧 **Configurable** — `--listen` address and `--base-path` for reverse proxy integration

## Architecture

```
Browser (HTML5 Canvas + JS)
    │
    │ WebSocket (JSON control + binary JPEG frames)
    │
Go HTTP Server
    │
    │ cgo bridge (C trampoline callbacks)
    │
FreeRDP v3 (libfreerdp3, libwinpr3)
    │
    │ RDP protocol (TLS)
    │
localhost:3389 (Windows RDP / Ubuntu xrdp)
```

---

## Quick Start

```bash
# Windows (from bundled dist/)
cd dist\windows
.\vcollab-web-rdp.exe --listen :8080

# Linux (from bundled dist/)
cd dist/linux
./run.sh --listen :8080

# Then open http://localhost:8080/ in your browser
```

### Command-Line Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--listen` | `:8080` | HTTP listen address |
| `--base-path` | `/` | URL base path (e.g. `/api/v/1/apps/rdp/`) |

---

## Prerequisites

### Go

**Required version:** Go 1.21+ (tested with Go 1.25)

- **Windows:** Download from https://go.dev/dl/ or `winget install GoLang.Go`  
- **Ubuntu:** `sudo apt install golang-go` or download from https://go.dev/dl/

Verify:
```bash
go version
# go version go1.25.x ...
```

### C Compiler (GCC)

CGO requires a GCC toolchain to compile the FreeRDP C bridge code.

### FreeRDP v3 Development Libraries

The `cgo` bindings link against FreeRDP v3's C libraries at compile time and load them at runtime.

---

## Windows Development Setup

### Step 1: Install MSYS2

MSYS2 provides the MinGW-w64 GCC toolchain and pre-built FreeRDP packages for Windows.

**Option A — Download installer (recommended):**
1. Download the installer from https://www.msys2.org/ (or https://github.com/msys2/msys2-installer/releases)
2. Run the installer, install to `C:\msys64` (default)
3. After installation, close any MSYS2 terminal that auto-opens

**Option B — Using winget:**
```powershell
winget install --id MSYS2.MSYS2 --accept-package-agreements
```

### Step 2: Update MSYS2

Open **MSYS2 UCRT64** terminal (from Start Menu) and run:
```bash
pacman -Syu
```
> ⚠️ The terminal may close during the update. If so, reopen it and run `pacman -Syu` again.

### Step 3: Install Build Dependencies

In the **MSYS2 UCRT64** terminal:
```bash
pacman -S --noconfirm \
  mingw-w64-ucrt-x86_64-gcc \
  mingw-w64-ucrt-x86_64-pkg-config \
  mingw-w64-ucrt-x86_64-freerdp
```

This installs:
- **GCC 15.x** — C compiler for cgo
- **pkg-config** — finds FreeRDP library flags automatically
- **FreeRDP v3** — development headers + runtime shared libraries (.dll)

### Step 4: Verify Installation

```powershell
# Verify GCC
C:\msys64\ucrt64\bin\gcc.exe --version
# gcc.exe (Rev13, Built by MSYS2 project) 15.x.x

# Verify pkg-config finds FreeRDP
C:\msys64\ucrt64\bin\pkg-config.exe --modversion freerdp3
# 3.x.x

# Verify libraries resolve
C:\msys64\ucrt64\bin\pkg-config.exe --libs freerdp3 freerdp-client3 winpr3
# -LC:/msys64/ucrt64/lib -lfreerdp-client3 -lfreerdp3 -lwinpr3
```

### Step 5: Build

#### Development Build (quick iteration)

```powershell
# Set environment for the current session
$env:CGO_ENABLED = "1"
$env:CC = "C:\msys64\ucrt64\bin\gcc.exe"
$env:PKG_CONFIG = "C:\msys64\ucrt64\bin\pkg-config.exe"
$env:PATH = "C:\msys64\ucrt64\bin;$env:PATH"

# Build and run
go run . --listen :8080
```

#### Production Build (bundled with DLLs)

```powershell
.\scripts\build-windows.ps1
```

This creates `dist\windows\` containing the binary and all required `.dll` files. The entire directory can be copied to another Windows machine and run without installing MSYS2.

> **Note:** The `-D__STDC_NO_THREADS__` CFLAGS workaround is embedded in the Go source (`rdp/rdp.go`) — no manual flags needed.

---

## Ubuntu/Debian Development Setup

### Step 1: Install Build Dependencies

```bash
# Update package lists
sudo apt update

# Install Go (if not already installed)
sudo apt install -y golang-go

# Install GCC and build essentials
sudo apt install -y build-essential pkg-config

# Install FreeRDP v3 development packages
sudo apt install -y libfreerdp3-dev freerdp3-dev libwinpr3-dev
```

> **Note:** Package names may vary by Ubuntu version. On Ubuntu 24.04+, the above should work directly. On older versions, you may need to add the FreeRDP PPA or build from source:
> ```bash
> sudo add-apt-repository ppa:freerdp-team/freerdp-nightly
> sudo apt update
> sudo apt install -y libfreerdp3-dev freerdp3-dev libwinpr3-dev
> ```

#### Alternative: Build FreeRDP from Source

If packages are unavailable for your distro:
```bash
sudo apt install -y cmake ninja-build libssl-dev libx11-dev libxext-dev \
  libxinerama-dev libxcursor-dev libxkbfile-dev libxv-dev libxi-dev \
  libxdamage-dev libxrandr-dev libfuse3-dev

git clone --branch stable-3.x https://github.com/FreeRDP/FreeRDP.git
cd FreeRDP
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --build build
sudo cmake --install build
sudo ldconfig
```

### Step 2: Verify Installation

```bash
# Verify GCC
gcc --version

# Verify pkg-config finds FreeRDP
pkg-config --modversion freerdp3
# 3.x.x

# Verify libraries resolve
pkg-config --libs freerdp3 freerdp-client3 winpr3
# -lfreerdp-client3 -lfreerdp3 -lwinpr3
```

### Step 3: Build

#### Development Build

```bash
CGO_ENABLED=1 go run . --listen :8080
```

#### Production Build (bundled with .so files)

```bash
chmod +x scripts/build-linux.sh
./scripts/build-linux.sh
```

This creates `dist/linux/` containing:
- `vcollab-web-rdp` — the binary
- `lib/` — all required `.so` shared libraries
- `run.sh` — launcher script that sets `LD_LIBRARY_PATH` automatically

The entire directory can be copied to another Linux machine and run via `./run.sh --listen :8080`.

### Step 4: Enable RDP on Ubuntu (xrdp)

If the target Ubuntu machine doesn't have RDP enabled:
```bash
sudo apt install -y xrdp
sudo systemctl enable xrdp
sudo systemctl start xrdp

# Verify it's listening
ss -tlnp | grep 3389
```

---

## Fedora/RHEL Development Setup

```bash
# Install dependencies
sudo dnf install -y golang gcc pkg-config freerdp-devel

# Verify
pkg-config --modversion freerdp3

# Build
CGO_ENABLED=1 go build -o vcollab-web-rdp .
```

---

## Project Structure

```
vcollab-web-rdp/
├── main.go                    # Entry point: parse flags, start HTTP server
├── server.go                  # HTTP server: static files, WebSocket upgrade
├── session.go                 # WebSocket session: auth, frame relay, input
├── rdp/
│   ├── freerdp_bridge.h       # C header: BridgeContext, function declarations
│   ├── freerdp_bridge.c       # C impl: FreeRDP lifecycle, GDI, callbacks
│   └── rdp.go                 # Go cgo bindings: Connect, Disconnect, Input
├── web/
│   ├── index.html             # HTML5 UI: login form + canvas
│   ├── style.css              # Dark theme design system
│   └── app.js                 # WS client, canvas renderer, input capture
├── scripts/
│   ├── build-windows.ps1      # Windows bundled build script
│   └── build-linux.sh         # Linux bundled build script
├── go.mod
├── go.sum
└── README.md
```

---

## How It Works

### Connection Flow

1. User opens `http://host:8080/` → login form renders
2. User enters credentials → JS sends `{"type":"auth",...}` over WebSocket
3. Go backend receives credentials → calls `rdp.Connect()` (cgo → FreeRDP)
4. FreeRDP negotiates TLS with `localhost:3389`, initializes GDI framebuffer
5. On each screen update, FreeRDP calls `EndPaint` → C bridge extracts dirty rect → Go JPEG-encodes → sends binary WS message
6. Browser receives binary frame → parses header (x,y,w,h) → `drawImage()` on canvas
7. Keyboard/mouse events captured on canvas → JSON over WS → Go → FreeRDP input API

### Wire Protocol

**Client → Server (JSON):**
```jsonc
{"type":"auth","username":"admin","password":"P@ss","domain":""}
{"type":"key","code":30,"flags":0}        // key down (scancode 0x1E = 'A')
{"type":"key","code":30,"flags":32768}    // key up   (KBD_FLAGS_RELEASE)
{"type":"mouse","x":500,"y":300,"flags":12288}  // left click down
```

**Server → Client:**
```jsonc
{"type":"auth_ok","width":1920,"height":1080}
{"type":"auth_fail","error":"connection refused"}
{"type":"error","message":"RDP session ended"}
```
Binary frames: `[2B x][2B y][2B w][2B h][JPEG payload]` (uint16 little-endian)

---

## Troubleshooting

### Windows: `threads.h: No such file or directory`

This is handled automatically by `-D__STDC_NO_THREADS__` in the cgo CFLAGS. If you see this error, ensure you're building from the project root with the correct source files.

### Windows: `gcc.exe not found`

Ensure MSYS2 UCRT64 bin directory is in your PATH:
```powershell
$env:PATH = "C:\msys64\ucrt64\bin;$env:PATH"
```

### Windows: DLL not found at runtime

Either:
- Run from the `dist\windows\` directory (which has all DLLs bundled), or
- Add `C:\msys64\ucrt64\bin` to your system PATH

### Linux: `pkg-config: freerdp3 not found`

Install FreeRDP development packages:
```bash
# Ubuntu/Debian
sudo apt install libfreerdp3-dev freerdp3-dev libwinpr3-dev

# If not available, build from source (see above)
```

### Linux: `.so` not found at runtime

Either:
- Use the bundled build (`./run.sh` sets `LD_LIBRARY_PATH` automatically), or
- Install FreeRDP system-wide: `sudo ldconfig`

### Connection fails to localhost:3389

- **Windows:** Ensure Remote Desktop is enabled in Settings → System → Remote Desktop
- **Ubuntu:** Install and start xrdp: `sudo apt install xrdp && sudo systemctl start xrdp`
- **Firewall:** Ensure port 3389 is not blocked for localhost

### Deprecation warnings during build

Warnings like `'codecs_free' is deprecated` are from FreeRDP headers and are harmless. The build still succeeds (exit code 0).

---

## Runtime Dependencies

### Windows
The bundled `dist\windows\` directory includes all required DLLs. No additional runtime dependencies needed — just copy and run.

Key DLLs included:
| Library | Purpose |
|---------|---------|
| `libfreerdp3.dll` | FreeRDP core RDP protocol |
| `libfreerdp-client3.dll` | FreeRDP client implementation |
| `libwinpr3.dll` | Windows Portability Runtime |
| `libssl-3-x64.dll` / `libcrypto-3-x64.dll` | TLS (OpenSSL) |
| `avcodec-62.dll` / `avutil-60.dll` | FFmpeg codecs (for H.264 GFX pipeline) |
| `zlib1.dll` | Compression |

### Linux
The bundled `dist/linux/` directory includes all non-system `.so` files. The launcher script (`run.sh`) sets `LD_LIBRARY_PATH` automatically.

System libraries (libc, libm, libpthread, ld-linux) are **not** bundled — these are always present on Linux.

---

## License

This project wraps [FreeRDP](https://github.com/FreeRDP/FreeRDP), which is licensed under the Apache License 2.0.
