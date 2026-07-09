#!/usr/bin/env bash
# Post-deploy smoke test — exercises the live edge over HTTPS and checks that
# public surfaces answer and operator-only surfaces are refused. Run on the host
# (or anywhere with DNS pointing at it) after deploy.sh.
set -uo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.production}"
# shellcheck disable=SC1090
source "$ENV_FILE"
BASE="https://${UMBRA_DOMAIN}"

pass=0; fail=0
check() { # description, expected_code, url
	local desc="$1" want="$2" url="$3"
	local got
	got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo 000)"
	if [[ "$got" == "$want" ]]; then printf '  \033[32mPASS\033[0m %-42s %s\n' "$desc" "$got"; ((pass++))
	else printf '  \033[31mFAIL\033[0m %-42s got %s want %s\n' "$desc" "$got" "$want"; ((fail++)); fi
}

echo "== Smoke test against ${BASE} =="
check "health"                        200 "${BASE}/health"
check "proof: signing key"            200 "${BASE}/v1/proof/key"
check "proof: transparency status"    200 "${BASE}/v1/proof/status"
check "proof: latest checkpoint"      200 "${BASE}/v1/proof/checkpoint/latest"
check "website root"                  200 "${BASE}/"
check "transparency page"             200 "${BASE}/transparency"
check "verify page"                   200 "${BASE}/verify"
check "admin refused at edge"         403 "${BASE}/v1/admin/stats"
check "admin (via /api) refused"      403 "${BASE}/api/admin/stats"
check "metrics refused at edge"       403 "${BASE}/metrics"

echo
if (( fail == 0 )); then echo "All ${pass} checks passed."; else echo "${fail} check(s) failed, ${pass} passed."; exit 1; fi
