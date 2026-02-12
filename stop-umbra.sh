#!/bin/bash
# ─────────────────────────────────────────────────────
# Umbra — Stop all services + tunnel
# ─────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Stopping Umbra..."

# Stop tunnel
if [ -f ".tunnel.pid" ]; then
    kill "$(cat .tunnel.pid)" 2>/dev/null || true
    rm -f .tunnel.pid
    echo "  Tunnel stopped"
fi

# Stop Docker services
docker compose down
echo "  Docker services stopped"
echo ""
echo "Umbra is offline."
