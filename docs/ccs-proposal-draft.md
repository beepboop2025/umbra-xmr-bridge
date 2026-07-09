---
layout: cp
title: Verifiable receipts and a public transparency log for Monero swap services
author: beepboop2025
date: July 9, 2026
amount: 57
milestones:
  - name: Specification and test vectors
    funds: 19
    done:
    status: unfinished
  - name: Standalone Rust crate and verifier CLI
    funds: 19
    done:
    status: unfinished
  - name: Integration guide, adoption kit and hardening
    funds: 19
    done:
    status: unfinished
payouts:
  - date:
    amount:
---

## What this is

Swap services are where Monero users get hurt. When you swap XMR for BTC through any instant exchanger, you are trusting a black box. If it quotes you one rate and settles another, keeps your deposit, or quietly starts seizing funds for some class of users, you have no proof of anything. You cannot even prove you were quoted a rate at all. The eXch shutdown showed how fast a service everyone relied on can disappear, and every exit scam in this space has worked because there was no public record to check against.

I built a proof layer that fixes this, and it is running in production today inside Umbra, my cross chain bridge (code at https://github.com/beepboop2025/umbra-xmr-bridge, live at https://umbra-xmr.com). Every order produces a signed receipt (ed25519, plus ML-DSA-65 so receipts stay verifiable in a post quantum world). Every receipt is appended to an RFC 6962 transparency log, the same construction browsers use for TLS certificates. The log publishes signed checkpoints, so the service cannot rewrite history or show different users different logs without producing cryptographic evidence against itself. There is also a canary and a drain guard sentinel that fails closed.

The problem: all of this is welded into my backend. It helps Umbra users and nobody else.

This proposal funds extracting it into a vendor neutral specification, a standalone Rust crate, and a small verifier CLI, so that any swap service can adopt it and any Monero user can independently verify any receipt from any adopting service. I am explicitly not asking the CCS to fund my bridge. I am asking it to fund the part every service can share.

## Why Monero needs this

Monero depends on swap services more than any other coin. Getting in and out of XMR without KYC almost always means trusting an instant exchanger, and the community has been burned repeatedly. Today the only defenses are reputation threads and vibes.

With this standard adopted, the trust model changes:

* A user can verify their receipt against the service's public log in one command.
* Selective cheating becomes detectable, because omitting or altering a receipt breaks the log's consistency proofs.
* A service that goes rogue leaves a public, timestamped evidence trail instead of a locked Telegram channel.
* Reviewers and aggregators can check a service's log instead of taking its word.

Certificate Transparency did this for CAs. Nobody built it for swap services. Monero is the ecosystem with the most to gain, because its users are the ones who cannot fall back on chargebacks or subpoenas.

## What exists already

Working, tested code in the Umbra repo: signed receipts, the RFC 6962 log with checkpoint signing, post quantum signatures, canary, fail closed sentinel, CI, and a public verify page. You can create an order on the live site right now and check its receipt against the log. Umbra itself is honest about its stage: it runs on stagenet, settlement is wired on the XMR side only, and the MPC currently runs in solo operator mode. None of those caveats touch the proof layer, which is exactly why it should be split out and shared.

## Deliverables

**Milestone 1: Specification and test vectors (60 hours, 19 XMR).**
A written spec covering the receipt wire format, signing rules for both signature schemes, log structure, checkpoint format, canary rules, and the verification algorithm. Includes a full set of test vectors so independent implementations can check themselves. Published under CC0 in its own repository.

**Milestone 2: Standalone Rust crate and verifier CLI (120 hours, 19 XMR).**
A `swap-receipts` crate with no dependency on my backend, implementing issuance and verification, plus a `receipt-verify` CLI a user can run against any adopting service. Umbra migrates to the crate, which proves the extraction is real and keeps one production deployment exercising it. Both published on crates.io with the same license as the spec.

**Milestone 3: Integration guide, threat model and adoption kit (60 hours, 19 XMR).**
Documentation aimed at existing services: how to add issuance to your backend in days, how to host a log, what it costs to run. A written threat model covering what the scheme does and does not protect against, in plain language. Outreach to existing swap services and aggregators, with a written summary of responses posted to the proposal thread.

Timeline is about three months. I will post progress reports on the proposal thread at each milestone and can attend community meetings.

## Who I am

I work under the pseudonym beepboop2025, which I understand carries weight here only insofar as the code does. Everything I am describing is public and running, so please judge the repository rather than the name. I wrote the bridge, the proof layer, the deploy stack and the tests myself.

## Funding

240 hours at 75 USD per hour is 18,000 USD, which is 57 XMR at roughly 316 USD (spot at time of writing). Split evenly, 19 XMR per milestone, paid on completion of each. If the rate moves a lot before merge I am happy to adjust the XMR figure so the USD ask stays the same.
