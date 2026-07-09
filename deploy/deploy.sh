#!/usr/bin/env bash
# One-command production deploy for Umbra.
#   ./deploy/deploy.sh            # core stack (site + API + proof layer)
#   ./deploy/deploy.sh --profile bot   # also start the Telegram bot
#
# Wraps preflight -> build -> up -> smoke test. Idempotent: re-running updates
# in place (rebuilds changed images, applies migrations on API start).
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE=(docker compose -f compose.prod.yml --env-file "$ENV_FILE")

echo "== Umbra deploy =="
bash deploy/preflight.sh

echo
echo "== Building + starting =="
"${COMPOSE[@]}" up -d --build "$@"

echo
echo "== Waiting for API health =="
for i in $(seq 1 40); do
	if "${COMPOSE[@]}" exec -T api curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
		echo "API healthy"; break
	fi
	[[ $i -eq 40 ]] && { echo "API did not become healthy in time — check: ${COMPOSE[*]} logs api"; exit 1; }
	sleep 3
done

echo
bash deploy/smoke-test.sh || echo "(smoke test reported issues — see above)"

echo
echo "== Running containers =="
"${COMPOSE[@]}" ps
echo
echo "Done. Tail logs with:  ${COMPOSE[*]} logs -f"
