<p align="center">
  <img src="public/monero.svg" width="40" alt="XMR" />&nbsp;&nbsp;
  <strong style="font-size: 2em;">UMBRA</strong>&nbsp;&nbsp;
  <img src="public/ton.svg" width="40" alt="TON" />
</p>

<h3 align="center">Privacy-first cross-chain bridge</h3>

<p align="center">
  Swap XMR, BTC, ETH, TON, SOL and more — trustless MPC threshold signatures, real-time rates, zero KYC.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

---

## What is Umbra?

Umbra is a non-custodial cross-chain bridge built around **Monero** — the only cryptocurrency with mandatory privacy. It enables trustless swaps between privacy coins and public blockchains using **FROST threshold signatures** (2-of-3 MPC), meaning no single party ever holds your funds.

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

**Single Rust binary** replaces what would typically be 3+ Python processes. The backend handles HTTP API, WebSocket streaming, background task scheduling, and blockchain RPC — all in one process using `tokio`.

---

## Three Interfaces, One Backend

### 1. Telegram Mini App
Mobile-optimized bridge UI that runs inside Telegram. Tap, swap, done.

### 2. Telegram Bot
Full conversational bridge — `/bridge`, `/rate`, `/history`, `/status`. Works without ever leaving the chat.

### 3. Enterprise Website
Desktop dashboard with portfolio tracking, analytics charts, order history, public transaction explorer, and admin panel.

All three share the same Rust API and real-time WebSocket feed.

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
│   │   ├── routes/        # HTTP + WebSocket endpoints
│   │   ├── services/      # Rate engine, order lifecycle, audit chain
│   │   ├── blockchain/    # Monero, Bitcoin, EVM, TON, Solana RPC clients
│   │   ├── mpc/           # FROST threshold signatures, coordinator, signers
│   │   ├── middleware/     # Security headers, rate limiting, Telegram auth
│   │   ├── tasks/         # Deposit monitor, confirmation checker, expiry
│   │   ├── models/        # SQLx models (orders, rates, audit, MPC)
│   │   └── utils/         # Crypto helpers, address validation
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
├── docker-compose.yml     # Full stack orchestration (10 services)
├── nginx.conf             # Reverse proxy + rate limiting
└── monitoring/            # Prometheus + Grafana config
```

---

## How a Bridge Swap Works

```
1. User selects pair         XMR -> TON, enters amount
2. Rate lock                 Cross-rate from CoinGecko (30s cache)
3. Order created             Deposit address generated, 30min expiry
4. Deposit detected          Monero wallet-rpc monitors subaddress
5. Confirmations             10 confirms for XMR, 1 for TON
6. MPC signing               2-of-3 FROST threshold signature
7. Withdrawal sent           TON transfer broadcast
8. Complete                  User notified via WebSocket + Telegram
```

---

## Security

- **FROST 2-of-3 MPC** — No single party can sign transactions
- **Hash-chain audit log** — Every state change is tamper-evident (SHA-256 chain)
- **Telegram WebApp auth** — HMAC-SHA-256 verification of `initData`
- **Rate limiting** — Redis sliding window (60/min API, 10/min orders, 5 WS/IP)
- **Security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Argon2id** — Password hashing for admin accounts
- **JWT** — Admin authentication with configurable expiry
- **Anti-replay** — Nonce-based protection on order creation and MPC signing
- **Address validation** — Per-chain regex validation (XMR base58, BTC bech32, ETH checksum, TON friendly/raw, SOL base58)

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

### Admin
```
POST /v1/admin/login                        JWT authentication
GET  /v1/admin/stats                        System statistics
POST /v1/admin/order/:id/refund             Manual refund
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

---

## License

Private. All rights reserved.
