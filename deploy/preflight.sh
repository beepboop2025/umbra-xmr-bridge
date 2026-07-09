#!/usr/bin/env bash
# Preflight checks before a production deploy. Validates required secrets, DNS,
# ports and tooling — fails loud rather than letting the stack come up half-wired.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.production}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

fail=0
warn=0

echo "== Umbra preflight =="

# --- env file ---
if [[ ! -f "$ENV_FILE" ]]; then
	red "MISSING: $ENV_FILE (copy deploy/.env.production.example and fill it in)"
	exit 1
fi
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a

require() { # name, [minlen]
	local name="$1" min="${2:-1}" val="${!1:-}"
	if [[ -z "$val" ]]; then red "MISSING required: $name"; fail=1
	elif (( ${#val} < min )); then red "TOO SHORT: $name (need >= $min chars)"; fail=1
	else green "ok: $name"; fi
}

require UMBRA_DOMAIN
require ACME_EMAIL
require POSTGRES_PASSWORD 16
require SECRET_KEY 32
require RISK_API_KEY 16

# --- recommended-but-not-required ---
if [[ -z "${ATTESTATION_SECRET_KEY:-}" ]]; then
	yellow "warn: ATTESTATION_SECRET_KEY empty — receipt-signing key will be derived from SECRET_KEY"
	warn=1
fi
if [[ -z "${MONERO_RPC_URL:-}" && -z "${ETH_RPC_URL:-}" ]]; then
	yellow "warn: no blockchain RPCs set — the site will serve but no chain can process live swaps yet"
	warn=1
fi

# --- DNS: does UMBRA_DOMAIN resolve to this host? ---
if command -v dig >/dev/null 2>&1; then
	pub_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
	dom_ip="$(dig +short "${UMBRA_DOMAIN}" A | tail -1)"
	if [[ -n "$pub_ip" && -n "$dom_ip" ]]; then
		if [[ "$pub_ip" == "$dom_ip" ]]; then green "ok: DNS ${UMBRA_DOMAIN} -> ${dom_ip} (this host)"
		else yellow "warn: ${UMBRA_DOMAIN} -> ${dom_ip}, but this host is ${pub_ip}. TLS issuance needs the A record pointing here."; warn=1; fi
	else
		yellow "warn: could not compare DNS (${UMBRA_DOMAIN} -> '${dom_ip:-none}', host -> '${pub_ip:-unknown}')"; warn=1
	fi
fi

# --- ports 80/443 free on the host, OR already held by our own stack ---
# On a redeploy our Caddy legitimately holds 80/443; compose recreates it. Only
# a *foreign* listener is a real conflict.
stack_caddy="$(docker compose -f compose.prod.yml --env-file "$ENV_FILE" ps -q caddy 2>/dev/null || true)"
for p in 80 443; do
	if command -v ss >/dev/null 2>&1 && ss -ltnH "( sport = :$p )" 2>/dev/null | grep -q ":$p"; then
		if [[ -n "$stack_caddy" ]]; then
			yellow "note: :$p held by the running Umbra stack — compose will recreate it"
		else
			red "PORT IN USE: :$p is bound by another service. Stop it first."; fail=1
		fi
	fi
done

# --- docker present ---
if ! docker compose version >/dev/null 2>&1; then
	red "MISSING: docker compose"; fail=1
else green "ok: docker compose"; fi

echo
if (( fail )); then red "PREFLIGHT FAILED — fix the items above before deploying."; exit 1; fi
if (( warn )); then yellow "Preflight passed with warnings."; else green "Preflight passed."; fi
