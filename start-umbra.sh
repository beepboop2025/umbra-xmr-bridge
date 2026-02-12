#!/bin/bash
# ─────────────────────────────────────────────────────
# Umbra — Start all services + Cloudflare tunnel
# ─────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_LOG="$SCRIPT_DIR/tunnel.log"
TUNNEL_PID_FILE="$SCRIPT_DIR/.tunnel.pid"

cd "$SCRIPT_DIR"

echo "══════════════════════════════════════════"
echo "  UMBRA — Privacy-first cross-chain bridge"
echo "══════════════════════════════════════════"
echo ""

# ── 1. Start Docker services ──
echo "[1/3] Starting Docker services..."
docker compose up -d --build

echo ""
echo "[2/3] Waiting for API health check..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        echo "       API is healthy!"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "       WARNING: API health check timed out (services may still be starting)"
    fi
    sleep 2
done

# ── 2. Kill any existing tunnel ──
if [ -f "$TUNNEL_PID_FILE" ]; then
    OLD_PID=$(cat "$TUNNEL_PID_FILE")
    kill "$OLD_PID" 2>/dev/null || true
    rm -f "$TUNNEL_PID_FILE"
fi

# ── 3. Start Cloudflare tunnel ──
echo ""
echo "[3/3] Starting Cloudflare tunnel..."
cloudflared tunnel --url http://localhost:80 \
    --no-autoupdate \
    > "$TUNNEL_LOG" 2>&1 &

TUNNEL_PID=$!
echo "$TUNNEL_PID" > "$TUNNEL_PID_FILE"

# Wait for tunnel URL to appear
sleep 5
for i in $(seq 1 12); do
    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
    sleep 2
done

echo ""
echo "══════════════════════════════════════════"
if [ -n "$TUNNEL_URL" ]; then
    echo "  UMBRA IS LIVE!"
    echo ""
    echo "  Public URL:  $TUNNEL_URL"
    echo "  Website:     $TUNNEL_URL"
    echo "  Mini App:    $TUNNEL_URL/app"
    echo "  API:         $TUNNEL_URL/api/health"
    echo ""
    echo "  Local:"
    echo "  Website:     http://localhost:3001"
    echo "  Mini App:    http://localhost:3000"
    echo "  API:         http://localhost:8000"
    echo "  Grafana:     http://localhost:3002"
    echo "  Prometheus:  http://localhost:9090"
else
    echo "  Docker services are running!"
    echo "  Tunnel URL not detected yet — check tunnel.log"
    echo ""
    echo "  Local:"
    echo "  Website:     http://localhost:3001"
    echo "  Mini App:    http://localhost:3000"
    echo "  API:         http://localhost:8000"
fi
echo "══════════════════════════════════════════"
echo ""
echo "  To stop:  ./stop-umbra.sh"
echo "  Logs:     docker compose logs -f"
echo "  Tunnel:   cat tunnel.log"
echo ""
