#!/usr/bin/env bash
# Launch vcollab-web-rdp with bundled libraries
DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="$DIR/lib:${LD_LIBRARY_PATH:-}"
exec "$DIR/vcollab-web-rdp" "$@"
