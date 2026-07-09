# Deploying Umbra to your own server (umbra-xmr.com)

This kit runs the full stack (Rust API, Postgres, Redis, risk engine, Next.js
website, Telegram mini app, optional bot) behind a single Caddy edge that
terminates TLS and gets Let's Encrypt certificates automatically.

Only Caddy is exposed to the internet (ports 80 and 443). The database, cache,
API and internal services are reachable only on the private Docker network.

```
                 Internet
                    │  443 / 80
             ┌──────▼──────┐
             │    Caddy     │  auto TLS, routing, security headers
             └──┬────┬───┬──┘
     /api /v1  │    │   │  /app        /
     /v1/proof │    │   └───────► miniapp
        ┌──────▼─┐  └──────────► website (Next.js)
        │  api   │  (Rust)
        └─┬───┬──┘
   ┌──────▼┐ ┌▼─────────────┐   ┌──────────────┐
   │postgres│ │    redis     │   │ risk-engine  │
   └────────┘ └──────────────┘   └──────────────┘
```

## 0. What you need

- A dedicated Linux server (Ubuntu 22.04/24.04 recommended). Start around
  4 vCPU / 8 GB RAM / 80 GB SSD. The Rust image builds with LTO, so give the
  build at least 4 GB free or build once and reuse the image.
- Root or sudo SSH access.
- The domain `umbra-xmr.com` (registered at GoDaddy).

Do not reuse a shared box that already runs other services. A bridge holding
hot keys should have its own hardened host.

## 1. Prepare the server

```bash
# as root, on the server
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh          # Docker Engine + compose plugin

# firewall: allow only SSH + web
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw --force enable

# a non-root user in the docker group (optional but recommended)
adduser --disabled-password --gecos "" umbra
usermod -aG docker umbra
```

## 2. Point DNS at the server (GoDaddy)

Get the server's public IP (`curl https://api.ipify.org`). Then in GoDaddy:

1. **My Products → Domains → umbra-xmr.com → DNS / Manage DNS**.
2. Edit the **A** record named `@`: set **Value** to your server IP, TTL 600.
3. Add/keep an **A** record named `www` with the same IP
   (or a CNAME `www → umbra-xmr.com`).
4. Remove the GoDaddy parking/forwarding record if present.

DNS must resolve to the server before you deploy, because Let's Encrypt
validates over HTTP. Check with `dig +short umbra-xmr.com` from the server.

## 3. Get the code and secrets in place

```bash
git clone https://github.com/beepboop2025/umbra-xmr-bridge.git
cd umbra-xmr-bridge

cp deploy/.env.production.example .env.production
```

Generate the required secrets:

```bash
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
echo "RISK_API_KEY=$(openssl rand -hex 24)"
echo "ATTESTATION_SECRET_KEY=$(openssl rand -hex 32)"   # recommended
echo "ATTESTATION_PQ_SEED=$(openssl rand -hex 32)"      # recommended
```

Paste them into `.env.production` and set `UMBRA_DOMAIN=umbra-xmr.com` and
`ACME_EMAIL`. Leave the blockchain RPCs blank for now if you are only bringing
the site up first (see the go-live checklist below).

Back `.env.production` up somewhere safe. It is gitignored on purpose.

## 4. Deploy

```bash
./deploy/deploy.sh
```

This runs preflight checks (secrets, DNS, ports), builds the images, starts the
stack, waits for the API to go healthy, and runs an HTTPS smoke test. First run
takes a while (the Rust image compiles from scratch).

To also run the Telegram bot (needs `TELEGRAM_BOT_TOKEN`):

```bash
./deploy/deploy.sh --profile bot
```

When it finishes, `https://umbra-xmr.com` is live with a valid certificate. You
can re-run the smoke test any time:

```bash
./deploy/smoke-test.sh
```

## 5. Operating it

```bash
C="docker compose -f compose.prod.yml --env-file .env.production"

$C ps                      # status
$C logs -f api             # follow API logs
$C logs -f caddy           # TLS / routing
$C restart api             # restart one service
$C down                    # stop everything (data volumes persist)
git pull && ./deploy/deploy.sh   # update to latest and redeploy
```

**Database backup** (do this on a schedule):

```bash
$C exec -T postgres pg_dump -U umbra umbra | gzip > umbra-$(date +%F).sql.gz
```

### Admin API (operator only)

The admin endpoints (`/v1/admin/*`) and `/metrics` are refused at the edge on
purpose. Reach them from the server itself, not the public internet:

```bash
# open the API port locally on the server
$C exec api sh -c 'apk add --no-cache curl >/dev/null 2>&1; true'
# then from the host, hit the container directly:
docker compose -f compose.prod.yml exec api curl -s localhost:8000/v1/admin/stats
```

Pause / resume the bridge (the sentinel also does this automatically):

```
POST /v1/admin/sentinel/pause    {"reason": "..."}
POST /v1/admin/sentinel/resume   {"note": "..."}
```

Both are visible on the public `/v1/proof/status` page: you cannot pause or
resume in secret.

## 6. Go-live checklist (before accepting real deposits)

Bringing the site up is safe. Accepting real funds is a separate, deliberate
step. Do not skip these:

- [ ] **Wallet / MPC keys.** The bridge signs withdrawals with FROST 2-of-3
      threshold signatures. Provision the three signer shares on separate
      infrastructure. A single box holding all shares is not real MPC.
- [ ] **Blockchain RPCs + deposit addresses.** Set `MONERO_RPC_URL`,
      `ETH_RPC_URL`, `BITCOIN_RPC_URL`, `SOLANA_RPC_URL`, `TON_API_URL` and the
      `*_DEPOSIT_ADDRESS` values for each chain you enable. Prefer your own
      nodes over public RPCs for privacy and reliability.
- [ ] **Sentinel outflow caps.** Set `SENTINEL_OUTFLOW_CAPS` to match your real
      liquidity. This is the volume at which the bridge halts intake. Too low
      causes nuisance halts; too high lets a drain run longer before it trips.
- [ ] **Small-amount end-to-end test** on each chain before opening the doors.
- [ ] **Backups + monitoring** running (pg_dump cron, uptime alerting).
- [ ] **Legal / compliance.** A no-KYC cross-chain bridge is a regulated
      activity in most jurisdictions (money transmission / VASP / AML). Confirm
      your position before taking third-party funds.

## 7. Known gaps (not blockers for hosting)

- The website's **dashboard analytics, explorer, and saved-wallet** pages call
  backend endpoints (`/api/stats`, `/api/explorer/*`, `/api/wallet/*`) that are
  not implemented in the Rust API yet. Those pages will show errors. The
  working surface today is: landing page, `/bridge` (rates + order creation),
  and the proof pages (`/transparency`, `/verify`). Wiring the missing
  endpoints is a backend task, tracked separately.
- The Telegram mini app and bot assume `https://umbra-xmr.com/app`; set the
  bot's menu button / web app URL to match if you enable the bot.

## 8. Why it is laid out this way

- **Caddy over nginx for the edge:** automatic certificate issuance and renewal
  with almost no config, and it is the single place that maps the frontend's
  `/api/*` calls onto the backend's `/v1/*` routes.
- **No published database ports:** Postgres and Redis are on the internal
  network only, so a firewall slip cannot expose them.
- **Redis `noeviction` + `appendonly`:** the sentinel's pause flag lives in
  Redis; eviction or a restart must not silently clear a tripped breaker.
- **Admin and metrics refused at the edge:** the operator surface is reachable
  only from the host, not the internet.
