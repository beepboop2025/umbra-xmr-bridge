<!-- textura-banner -->
<div align="center">
  <a href="https://github.com/beepboop2025/umbra-xmr-bridge"><img src="./banner.svg" width="100%" alt="umbra-xmr-bridge" /></a>
</div>

<p align="center">
  <a href="https://github.com/beepboop2025/umbra-xmr-bridge/actions/workflows/tests.yml"><img src="https://github.com/beepboop2025/umbra-xmr-bridge/actions/workflows/tests.yml/badge.svg" alt="tests" /></a>
  <img src="https://img.shields.io/badge/coverage-85%25-brightgreen" alt="coverage" />
</p>

<p align="center">
  <img src="public/monero.svg" width="40" alt="XMR" />&nbsp;&nbsp;
  <strong style="font-size: 2em;">UMBRA</strong>&nbsp;&nbsp;
  <img src="public/ton.svg" width="40" alt="TON" />
</p>

<h3 align="center">Experimental cross-chain swap platform</h3>

<p align="center">
  Swap workflows for XMR, BTC, ETH, TON, SOL, and other configured assets, with threshold-signature custody and signed audit records.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

---

## Status and scope

Umbra is an experimental cross-chain swap platform centered on **Monero** and
public-chain assets. The current implementation includes a custodial path with a
2-of-3 FROST threshold-signing flow. Its custody properties depend on independent
key-share control, deployment configuration, upstream services, and operational
controls; threshold signatures alone do not make a service trustless.

The atomic-swap core is a **pre-audit design** intended for testnet work only. See
[`docs/ATOMIC_SWAP_SPEC.md`](docs/ATOMIC_SWAP_SPEC.md); do not deploy code derived
from that design to mainnet without the external review described there.

The **Proof Layer** records selected application events in signed receipts and an
append-only log, with tools for offline verification. It improves auditability but
does not prove events the application failed to record or remove the need to trust
key distribution and independently witnessed checkpoints.

---

## The Proof Layer

Cross-chain services have recurring custody and operational risks. Umbra includes
the following receipt, log, monitoring, and verification components:

```
              ┌─────────────────────────────────────────────────────────┐
              │                      PROOF LAYER                        │
              │                                                         │
   recorded   │  ┌────────────┐   sealed    ┌──────────────────┐        │
   events ───►│  │  Signed    │  on schedule│  Transparency    │        │
   event      │  │  Receipts  │────────────►│  Log (Merkle)    │        │
              │  │ Ed25519 +  │             │  RFC 6962 proofs │        │
              │  │ ML-DSA-65  │             └────────┬─────────┘        │
              │  └────────────┘                      │ anchors          │
              │                                      ▼                  │
              │  ┌──────────────────┐        ┌──────────────┐           │
              │  │  Sentinel        │        │  Signed      │           │
              │  │  5 guards, 30s   │        │  Canary      │           │
              │  │  + Isolation     │        │  (freshness- │           │
              │  │    Forest (ML)   │        │   bound)     │           │
              │  └──────────────────┘        └──────────────┘           │
              └─────────────────────────────────────────────────────────┘
                        ▲ verify offline: browser page, single-file
                          HTML, or pure-stdlib Python CLI — zero trust
```

### 1. Signed swap receipts

For lifecycle events recorded by the application (`order_created`,
`status_confirming`, `status_completed`, and others), the service produces a receipt
signed with its **Ed25519** key over canonical JSON. Receipts for one order are
hash-chained, allowing a verifier with the chain and a trusted public key to detect
edits or gaps. The receipt schema uses a hash of the destination address rather than
the address itself, reducing the data exposed by this layer.

```bash
curl -s https://your-bridge/v1/proof/receipt/br_ab12cd34ef56 | \
    python3 tools/verify_receipt.py receipts - --pin <PUBLIC_KEY>
```

### 2. Post-quantum hybrid signatures

The implementation can sign the same canonical receipt and checkpoint bytes with
**ML-DSA-65 (FIPS 204)** alongside Ed25519. Long-term security still depends on
correct implementation, protected keys, verifier support, and the continuing
security of both schemes.

### 3. Transparency log — Certificate Transparency for a bridge

The audit hash-chain is sealed on a configured schedule into a **signed Merkle
checkpoint** using an RFC 6962 construction. The API exposes:

- **Inclusion proofs** — `GET /v1/proof/inclusion/{audit_id}` proves a specific audit entry is committed to by a checkpoint (log₂ n hashes, verifiable offline).
- **Consistency proofs** — `GET /v1/proof/consistency?old_size=&new_size=` lets a verifier test whether a newer checkpoint extends an older retained checkpoint.

An external monitor can retain `GET /v1/proof/checkpoint/latest` responses and compare
later checkpoints. Detection of split views requires checkpoints to be shared or
witnessed outside the operator's control.

### 4. The Sentinel — a circuit breaker between the bridge and catastrophe

Five configurable checks make up the Sentinel monitor:

| Guard | Trips when | Would have caught |
|-------|-----------|-------------------|
| Outflow velocity | per-chain outbound volume exceeds hourly caps | Ronin, Harmony (key-compromise drains) |
| Order velocity | order creation rate spikes | bot floods, probing attacks |
| Failure spike | failed orders cluster | subsystem exploitation |
| Rate divergence | independent price sources disagree > 5% | oracle poisoning |
| **ML anomaly** (optional) | Isolation Forest flags order-flow combinations vs the 7-day baseline | drain signatures no fixed threshold expresses |

The intended trip behavior pauses new intake while allowing in-flight settlement. A
manual resume requires a note. The application records trip, pause, and resume events
in its audit chain and exposes status at `GET /v1/proof/status`; observers can verify
only the events and checkpoints they receive. The optional anomaly check fails open,
so an outage in that component does not itself stop intake.

### 5. Signed, freshness-bound warrant canary

`GET /v1/proof/canary` returns a signed statement containing a timestamp and the latest
checkpoint root. Verifiers must enforce a freshness window and retain or compare
checkpoints for the canary to provide useful rewind detection.

### Verify without trusting anything

Three independent verifiers ship in this repo, all validated against RFC 8032 test vectors and against each other:

| Verifier | Trust required |
|----------|---------------|
| `website /verify` page | verification runs client-side in your browser |
| [`verifier/umbra-verify.html`](verifier/umbra-verify.html) | **none** — save the file, open from `file://`, zero network requests, pure-BigInt Ed25519 with an on-load self-test |
| [`tools/verify_receipt.py`](tools/verify_receipt.py) | **none** — pure Python stdlib, no dependencies; `receipts`/`checkpoint`/`inclusion` subcommands |

Pin the service's public key (`GET /v1/proof/key`) through a channel outside the
deployment before relying on receipt verification. Telegram exposes the same flow via
`/receipt <order_id>` and `/trust`.

The full wire-format specification — exact canonical forms, algorithms, threat model, and test vectors for building your own verifier — lives in [`docs/PROOF_LAYER.md`](docs/PROOF_LAYER.md).

### Supported Chains

| Chain | Ticker | Type |
|-------|--------|------|
| Monero | XMR | Privacy L1 |
| Bitcoin | BTC | L1 |
| Ethereum | ETH | L1 |
| TON | TON | L1 |
| Solana | SOL | L1 |
| Arbitrum | ARB | L2 (EVM) |
| Base | BASE | L2 (EVM) |
| USDT / USDC | Stablecoins | Multi-chain |

---

## Architecture

```
                        +------------------+
                        |   Nginx Proxy    |
                        |  :80 / :443      |
                        +--------+---------+
                                 |
              +------------------+------------------+
              |                  |                  |
     /app     |        /        |        /api      |
              v                 v                  v
     +--------+------+  +------+-------+  +-------+-------+
     | Telegram Mini  |  |   Next.js    |  |  Rust Backend |
     | App (Vite)     |  |   Website    |  |  (axum)       |
     | :3000          |  |   :3001      |  |  :8000        |
     +----------------+  +--------------+  +---+---+-------+
                                               |   |
                            +------------------+   +--------+
                            |                               |
                    +-------v------+               +--------v-------+
                    |  PostgreSQL  |               |     Redis      |
                    |  :5432       |               |     :6379      |
                    +--------------+               +----------------+
                                                          |
              +-------------------------------------------+
              |                    |
     +--------v-------+  +--------v--------+
     | Telegram Bot   |  | Prometheus +    |
     | (aiogram)      |  | Grafana         |
     +----------------+  +-----------------+
```

The Rust backend handles the HTTP API, WebSocket streaming, background scheduling,
and blockchain RPC in one `tokio` process.

---

## Three Interfaces, One Backend

### 1. Telegram Mini App
Mobile-optimized bridge UI that runs inside Telegram. Tap, swap, done.

### 2. Telegram Bot
Full conversational bridge — `/bridge`, `/rate`, `/history`, `/status`. Works without ever leaving the chat.

### 3. Enterprise Website
Desktop dashboard with portfolio tracking, analytics charts, order history, public transaction explorer, admin panel — plus `/verify` (client-side receipt verification) and `/transparency` (live sentinel status, checkpoints, canary).

All three clients use the same Rust API and WebSocket feed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Rust, axum 0.7, sqlx, tokio, tower |
| **Database** | PostgreSQL 17, Redis 7 |
| **MPC** | FROST threshold signatures (`frost-secp256k1`) |
| **Blockchain** | monero-wallet-rpc, toncenter, EVM JSON-RPC, Solana RPC, Bitcoin Core |
| **Website** | Next.js 15, React 19, Tailwind CSS 4, Zustand, Recharts, TON Connect |
| **Mini App** | Vite 6, vanilla JS, Telegram WebApp SDK |
| **Bot** | Python, aiogram 3, httpx |
| **Monitoring** | Prometheus, Grafana |
| **Proxy** | Nginx with rate limiting |
| **Rates** | CoinGecko -> Binance -> CoinCap (triple fallback) |

---

## Quick Start

```bash
# Clone
git clone https://github.com/beepboop2025/umbra.git
cd umbra

# Configure
cp backend/.env.example .env
# Edit .env with your keys (Telegram bot token, RPC endpoints, etc.)

# Launch everything
docker compose up --build
```

| Service | URL |
|---------|-----|
| Website | http://localhost |
| Mini App | http://localhost/app |
| API | http://localhost/api/health |
| Grafana | http://localhost:3002 |
| Prometheus | http://localhost:9090 |

---

## Project Structure

```
umbra/
├── backend/               # Rust API (axum + sqlx + tokio)
│   ├── src/
│   │   ├── routes/        # HTTP + WebSocket endpoints (incl. /v1/proof/*)
│   │   ├── services/      # Rates, orders, attestations, transparency, sentinel
│   │   ├── blockchain/    # Monero, Bitcoin, EVM, TON, Solana RPC clients
│   │   ├── mpc/           # FROST threshold signatures, coordinator, signers
│   │   ├── middleware/     # Security headers, rate limiting, Telegram auth
│   │   ├── tasks/         # Deposit monitor, confirmations, expiry, sentinel, sealing
│   │   ├── models/        # SQLx models (orders, rates, audit, MPC)
│   │   └── utils/         # Crypto helpers, address validation, RFC 6962 Merkle
│   └── migrations/        # PostgreSQL schema
├── bot/                   # Telegram bot (aiogram 3)
│   └── bot/
│       ├── handlers/      # /start, /bridge, /rate, /history, /admin
│       ├── keyboards/     # Inline keyboards for bridge flow
│       └── services/      # Backend API client
├── website/               # Enterprise dashboard (Next.js 15)
│   └── src/
│       ├── app/           # Pages: bridge, dashboard, explorer, admin
│       ├── components/    # UI, bridge, charts, wallet, layout
│       ├── hooks/         # useRate, useOrders, useWebSocket, useWallet
│       ├── stores/        # Zustand state management
│       └── lib/           # API client, validators, utilities
├── src/                   # Telegram Mini App (Vite)
├── risk-engine/           # Python risk service (FastAPI)
│   └── services/          # Isolation Forest, MAD z-score, drain scoring
├── verifier/              # Single-file offline verifier (umbra-verify.html)
├── tools/                 # verify_receipt.py — pure-stdlib CLI verifier
├── docker-compose.yml     # Full stack orchestration (10 services)
├── nginx.conf             # Reverse proxy + rate limiting
└── monitoring/            # Prometheus + Grafana config
```

---

## How a Bridge Swap Works

```
1. User selects pair         XMR -> TON, enters amount
2. Rate lock                 Cross-rate from CoinGecko (30s cache)
3. Sentinel gate             Intake refused instantly if the circuit breaker is tripped
4. Order created             Deposit address generated, 30min expiry, signed receipt #0
5. Deposit detected          Monero wallet-rpc monitors subaddress
6. Confirmations             10 confirms for XMR, 1 for TON
7. MPC signing               2-of-3 FROST threshold signature
8. Withdrawal sent           TON transfer broadcast
9. Complete                  Signed receipt binds the withdrawal tx hash;
                             user notified via WebSocket + Telegram
```

From step 4 onward, the application is designed to emit hash-chained, dual-signed
receipts that the user can verify offline. This verifies the recorded history, not
off-log events or the correctness of upstream settlement.

---

## Security

- **FROST 2-of-3 signing flow** — Requires two configured key shares; security depends on independent share custody and deployment controls
- **Proof Layer** — Signed receipts (Ed25519 + ML-DSA-65), RFC 6962 transparency log, sentinel circuit breaker, signed canary (see above)
- **Hash-chain audit log** — Recorded state changes are chained and sealed into signed Merkle checkpoints
- **Telegram WebApp auth** — HMAC-SHA-256 verification of `initData`
- **Rate limiting** — Redis sliding window (60/min API, 10/min orders, 5 WS/IP)
- **Security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Argon2id** — Password hashing for admin accounts
- **JWT** — Admin authentication with configurable expiry
- **Anti-replay** — Nonce-based protection on order creation and MPC signing
- **Address validation** — Per-chain regex validation (XMR base58, BTC bech32, ETH checksum, TON friendly/raw, SOL base58)

### Key custody for the Proof Layer

The attestation identity is derived deterministically from `SECRET_KEY` by default (fine for development). In production set independent seeds — `ATTESTATION_SECRET_KEY` (Ed25519) and `ATTESTATION_PQ_SEED` (ML-DSA-65) — so receipt-signing custody can be separated from JWT custody, and publish the public keys from `GET /v1/proof/key` somewhere you don't control (a tweet, a git tag, another bridge's transparency page) so users can pin them.

---

## API Reference

### Rates
```
GET  /v1/rate?direction=XMR_TO_TON          Current rate + 24h change + sparkline
GET  /v1/rate/history?direction=&period=1h  Rate history (1h/4h/24h/7d/30d)
```

### Orders
```
POST /v1/order                              Create bridge order
GET  /v1/order/:id                          Order details
GET  /v1/orders?telegram_user_id=&limit=50  Order history
POST /v1/order/:id/cancel                   Cancel pending order
```

### WebSocket
```
WS   /v1/ws/order/:id                      Real-time order status updates
WS   /v1/ws/rates                           Live rate feed
```

### Proof Layer (public — no auth, by design)
```
GET  /v1/proof/key                          Bridge public keys (Ed25519 + ML-DSA-65) — pin these
GET  /v1/proof/receipt/:order_id            Signed receipts for an order (full lifecycle)
GET  /v1/proof/checkpoint/latest            Latest signed Merkle tree head
GET  /v1/proof/checkpoints?limit=20         Checkpoint history
GET  /v1/proof/inclusion/:audit_id          RFC 6962 inclusion proof for an audit entry
GET  /v1/proof/consistency?old_size=&new_size=  Append-only proof between two checkpoints
GET  /v1/proof/audit/verify                 Server-side full hash-chain walk
GET  /v1/proof/canary                       Signed, freshness-bound warrant canary
GET  /v1/proof/status                       Sentinel state: accepting orders? why not?
```

### Risk Engine (internal, X-API-Key)
```
POST /v1/risk/anomaly                       Statistical drain scores (MAD z-score, burst, round amounts)
POST /v1/risk/anomaly/ml                    Isolation Forest anomaly scores over order-flow features
```

### Admin
```
POST /v1/admin/login                        JWT authentication
GET  /v1/admin/stats                        System statistics
POST /v1/admin/order/:id/refund             Manual refund
GET  /v1/admin/sentinel                     Sentinel state + last 50 events
POST /v1/admin/sentinel/pause               Manual pause (reason required)
POST /v1/admin/sentinel/resume              Resume (investigation note required)
```

### System
```
GET  /health                                Liveness probe
GET  /ready                                 Readiness probe (DB + Redis)
GET  /metrics                               Prometheus metrics
```

---

## Monitoring

Prometheus scrapes the `/metrics` endpoint for:
- API request latency (p50/p95/p99)
- Order throughput and failure rate
- Rate source health and fetch duration
- WebSocket connection count
- Background task execution metrics

Grafana dashboards available at `:3002` (default password: `admin`).

---

## Development

```bash
# Backend only (requires local Postgres + Redis)
cd backend
cargo run

# Website only
cd website
npm install && npm run dev

# Mini App only
npm run dev

# Run backend tests
cd backend
cargo test
```

---

## Environment Variables

See [`backend/.env.example`](backend/.env.example) for the full list. Key ones:

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | JWT signing key (64+ chars) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `MONERO_RPC_URL` | monero-wallet-rpc endpoint |
| `TON_API_URL` | toncenter API |
| `ETH_RPC_URL` | Ethereum JSON-RPC |
| `BRIDGE_FEE_PERCENT` | Fee per swap (default: 0.3%) |
| `MPC_THRESHOLD` | Signatures required (default: 2) |
| `ATTESTATION_SECRET_KEY` | Ed25519 receipt-signing seed, 64 hex chars (derived from `SECRET_KEY` if unset) |
| `ATTESTATION_PQ_SEED` | ML-DSA-65 seed, 64 hex chars (derived if unset) |
| `PQ_SIGNATURES_ENABLED` | Post-quantum hybrid signatures (default: true) |
| `TRANSPARENCY_SEAL_INTERVAL_SECS` | Checkpoint sealing cadence (default: 300) |
| `CANARY_STATEMENT` | Warrant-canary text served at `/v1/proof/canary` |
| `SENTINEL_ENABLED` | Circuit breaker (default: true) |
| `SENTINEL_OUTFLOW_CAPS` | Per-chain hourly caps, e.g. `XMR:1000,BTC:20` |
| `RISK_ENGINE_URL` | Enables the Isolation Forest sentinel guard (optional) |

---

## License

Source-available under the [Source-Available License v1.0](LICENSE.md). You may view, study, fork, and run it locally for non-commercial evaluation and research. Commercial use, operating it as a service, or redistribution require a separate written license.
