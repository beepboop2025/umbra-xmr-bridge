# Stage 1: Build
# Latest stable Rust: several transitive deps (e.g. the edition-2024 crates
# pulled in via sqlx/ed25519/fips204) now require rustc > 1.78, so an old pin
# fails at the dependency layer. `rust:1` tracks the newest stable 1.x.
FROM rust:1-slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Build deps first for layer caching
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -r -s /bin/false bridge

WORKDIR /app
COPY --from=builder /app/target/release/xmr-bridge ./
COPY migrations ./migrations

USER bridge
EXPOSE 8000
ENV RUST_LOG=xmr_bridge=info,tower_http=info

CMD ["./xmr-bridge"]
