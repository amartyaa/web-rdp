#!/usr/bin/env bash
#
# build-linux.sh — Build vcollab-web-rdp and bundle FreeRDP shared libraries.
#
# Usage:
#   ./scripts/build-linux.sh              # outputs to dist/linux/
#   ./scripts/build-linux.sh dist/mydir   # custom output directory
#
set -euo pipefail

OUTPUT_DIR="${1:-dist/linux}"

# ── Validate prerequisites ──────────────────────────────────────────────────

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo "ERROR: '$1' not found. See README.md for installation instructions."
        exit 1
    fi
}

check_cmd gcc
check_cmd pkg-config
check_cmd go
check_cmd ldd

# Verify FreeRDP pkg-config modules exist
for mod in freerdp3 freerdp-client3 winpr3; do
    if ! pkg-config --exists "$mod" 2>/dev/null; then
        echo "ERROR: pkg-config module '$mod' not found."
        echo "       Install FreeRDP development packages:"
        echo "       Ubuntu/Debian: sudo apt install libfreerdp3-dev freerdp3-dev"
        echo "       Fedora:       sudo dnf install freerdp-devel"
        exit 1
    fi
done

echo "==> Environment"
echo "    Go:         $(go version)"
echo "    GCC:        $(gcc --version | head -1)"
echo "    FreeRDP:    $(pkg-config --modversion freerdp3)"
echo ""

# ── Build ────────────────────────────────────────────────────────────────────

export CGO_ENABLED=1

echo "==> Building vcollab-web-rdp ..."
go build -o vcollab-web-rdp .
echo "    Build successful."
echo ""

# ── Prepare output directory ─────────────────────────────────────────────────

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/lib"

cp vcollab-web-rdp "$OUTPUT_DIR/"

# ── Discover and copy runtime shared libraries ──────────────────────────────

echo "==> Discovering runtime shared libraries ..."

# Get all non-system .so dependencies
SO_FILES=$(ldd vcollab-web-rdp 2>/dev/null \
    | grep "=>" \
    | awk '{print $3}' \
    | grep -v "^$" \
    | grep -vE "^/(lib|lib64|usr/lib)/(x86_64-linux-gnu/)?(libc\.|libm\.|libdl\.|libpthread\.|librt\.|ld-linux)" \
    | grep -vE "linux-vdso" \
    | sort -u)

COUNT=0
TOTAL_SIZE=0

for so in $SO_FILES; do
    if [ -f "$so" ]; then
        name=$(basename "$so")
        cp "$so" "$OUTPUT_DIR/lib/$name"
        size=$(stat -c%s "$so" 2>/dev/null || stat -f%z "$so" 2>/dev/null || echo 0)
        TOTAL_SIZE=$((TOTAL_SIZE + size))
        COUNT=$((COUNT + 1))
        echo "    + $name ($(echo "scale=1; $size/1048576" | bc) MB)"
    fi
done

BINARY_SIZE=$(stat -c%s "$OUTPUT_DIR/vcollab-web-rdp" 2>/dev/null || stat -f%z "$OUTPUT_DIR/vcollab-web-rdp" 2>/dev/null)
TOTAL_SIZE=$((TOTAL_SIZE + BINARY_SIZE))

# ── Create launcher script ──────────────────────────────────────────────────

cat > "$OUTPUT_DIR/run.sh" << 'LAUNCHER'
#!/usr/bin/env bash
# Launch vcollab-web-rdp with bundled libraries
DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="$DIR/lib:${LD_LIBRARY_PATH:-}"
exec "$DIR/vcollab-web-rdp" "$@"
LAUNCHER
chmod +x "$OUTPUT_DIR/run.sh"

echo ""
echo "==> Bundle complete!"
echo "    Location:   $OUTPUT_DIR/"
echo "    Binary:     $(echo "scale=1; $BINARY_SIZE/1048576" | bc) MB"
echo "    Libraries:  $COUNT files"
echo "    Total size: $(echo "scale=1; $TOTAL_SIZE/1048576" | bc) MB"
echo ""
echo "    To run:"
echo "    cd $OUTPUT_DIR"
echo "    ./run.sh --listen :8080"
