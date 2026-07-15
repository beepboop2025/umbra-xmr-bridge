# Umbra Atomic-Swap Core — Design Specification v0.1 (pre-audit)

**Status: DESIGN ONLY. No implementation exists against this document. It is
written to be reviewed by a cryptography auditor before any fund-touching code
is written. Do not deploy anything derived from this spec to mainnet without an
external audit.**

## 0. Why this document exists

Umbra today is, in its own honest framing, a **federated MPC-custodial bridge**:
a user sends an asset to a per-order deposit address, and the bridge pays out the
destination asset from its own liquidity pools, authorizing the outbound
transaction with a FROST 2-of-3 threshold signature (`backend/src/mpc/`). The
2-of-3 signer set therefore **collectively custodies in-flight funds**, and the
user trusts (a) that the threshold does not collude and (b) that the pool is
solvent. The Proof Layer (`docs/PROOF_LAYER.md`) makes misbehaviour *provable
after the fact*; it does not *prevent* it.

This spec describes the upgrade that removes the custody assumption: replace the
pooled payout with **adaptor-signature atomic swaps**, so that either both legs
of a swap settle or both refund, enforced by cryptography rather than by an
honest majority. The target property is:

> **A user cannot lose funds even if the operator vanishes or turns malicious.**

The Proof Layer is retained unchanged — but it stops apologising for custody and
instead audits a core that no longer holds user funds.

## 1. Scope and the two swap classes

Umbra pairs Monero (XMR) with BTC, EVM chains (ETH/…), TON, and SOL. The right
primitive differs by whether the non-XMR chain has expressive scripting:

| Class | Chains | Primitive | Reference |
|-------|--------|-----------|-----------|
| A | XMR ↔ BTC | Adaptor-signature swap; both legs scriptless (Schnorr/Taproot on BTC, one-time VES on XMR) | Gugger 2020 (unstoppable swaps); arXiv:2503.12719 |
| B | XMR ↔ EVM | Adaptor secret released by an EVM smart-contract HTLC-equivalent; XMR leg via the same one-time-VES construction | arXiv:2406.16822; 2503.12719 |
| C | XMR ↔ TON / SOL | Same shape as B where the chain has usable time-locked conditional payments; **deferred** — TON/SOL conditional-payment ergonomics need their own review | — |

**v0.1 specifies Class A and Class B only.** Class C stays on the existing
custodial path, clearly labelled as such in the UI, until its primitive is
specified and audited. Silent mixing of trust models is forbidden.

Monero has **no scripting**, so a classic HTLC cannot be placed on the XMR leg.
The construction below never requires one: the XMR is locked to a 2-of-2 shared
output whose spend key is *split* between the parties, and the swap secret is the
missing half. This is the crux the auditor must scrutinise first.

## 2. Cryptographic primitives

- **Schnorr / Taproot adaptor signatures** on secp256k1 (BTC, EVM secp256k1
  keys). An adaptor pre-signature `σ̂` over message `m` is bound to a statement
  `T = t·G`; completing it to a valid `σ` requires the witness `t`, and
  publishing `σ` **reveals** `t` to anyone who saw `σ̂` (`t = s − ŝ mod n`). This
  linearity is the whole engine: the same secret unlocks one leg and is exposed
  by the other.
- **Monero one-time VES / DLSAG-style adaptor** for the XMR leg: the XMR output
  is spendable only by `sk = sk_A + sk_B` where each party holds one addend;
  the swap binds the *reveal* of the counterparty's addend to the completion of
  the BTC/EVM leg. (The auditor must confirm the exact construction against the
  current Monero consensus rules; Monero's ring signatures and the lack of
  script mean this is where subtle breaks live.)
- **zk-SNARK (Groth16 + Poseidon)** for the optional untraceability layer on the
  non-XMR leg (§6), per arXiv:2402.16735.
- Hashing, canonical JSON, Ed25519 receipts: **reuse the Proof Layer primitives
  unchanged** (`docs/PROOF_LAYER.md §1`). Every swap still emits a signed,
  hash-chained receipt into the transparency log.

## 3. Roles

- **Maker** — a liquidity provider (may be the operator, may be a third party).
  Quotes a price and provides the destination asset. Committed only after the
  taker has locked, so the maker takes **zero counterparty risk** and can price
  tight.
- **Taker** — the user. Initiates by locking the source asset first.
- **No custodian.** There is no signer set holding in-flight funds. The operator
  may still run matching, quoting, and the Proof Layer, but its compromise
  cannot move user funds — only deny service (§7).

The **taker-locks-first** ordering is deliberate and load-bearing: it is what
lets the maker act only on committed swaps and price without a counterparty-risk
premium (arXiv:2503.12719 §3).

## 4. Protocol — Class A (XMR ↔ BTC), the reference flow

Notation: Alice holds XMR, wants BTC. Bob (maker) holds BTC, wants XMR.

1. **Key setup (off-chain).** Alice and Bob each generate a spend-key share for
   the XMR side (`s_A`, `s_B`) and a secp256k1 key for the BTC side. They jointly
   compute the XMR lock address `S = (s_A + s_B)·G_xmr` and exchange public
   points with **zero-knowledge proofs of discrete-log equality** across the two
   curves (the cross-group DLEQ is mandatory — without it a party can lock to a
   key it cannot later be forced to reveal). **[AUDIT-1]**
2. **Alice locks XMR** to `S`. The output is now spendable only by `s_A + s_B`;
   neither party alone can move it.
3. **Bob pre-signs the BTC payout** to Alice with an adaptor signature `σ̂_B`
   bound to statement `T = s_A·G` (Alice's XMR key share as the witness), and
   funds a BTC output spendable by that completed signature, with a **refund
   path to Bob after timelock `t_BTC`**.
4. **Alice completes the BTC signature** using her own `s_A`, broadcasting
   `σ_B` and taking the BTC. By publishing `σ_B`, she **reveals `s_A`** to Bob
   (adaptor linearity).
5. **Bob reconstructs `s_A + s_B`** and sweeps the XMR. Swap complete; neither
   party ever trusted the other or a custodian.

**Refund safety (the correctness heart).** If Alice never completes the BTC leg,
Bob reclaims BTC after `t_BTC`. If Bob never funds the BTC leg, Alice reclaims
XMR after `t_XMR`. The timelocks **must** satisfy `t_XMR > t_BTC + Δ` where `Δ`
generously covers BTC confirmation latency, so that the party who must act second
always has a strictly-earlier window than the refund that would strand them.
Getting this ordering wrong is the classic atomic-swap fund-loss bug. **[AUDIT-2]**

## 5. Protocol — Class B (XMR ↔ EVM)

Identical shape, but the BTC adaptor/timelock is replaced by an EVM contract that
(a) escrows the maker's asset, (b) releases it on presentation of the witness
`t` (checking `H(t)` against a commitment, and/or verifying the adaptor
completion), and (c) refunds after timelock. The EVM contract is the
**oracle/factory** pattern of arXiv:2503.12719 §3.4: it must be minimal,
immutable per swap (deployed via a factory, beneficiary addresses fixed at
creation so a leaked secret only ever pays the intended party), and itself
audited as carefully as the crypto. **[AUDIT-3]**

## 6. Optional untraceability (non-XMR leg)

Monero already gives privacy on the XMR leg. To keep the BTC/EVM leg from being a
deanonymising beacon, apply **taprootized atomic swaps** (arXiv:2402.16735): the
adaptor statement is proven in zero knowledge (Groth16 + Poseidon), so the
on-chain BTC/EVM transaction is **indistinguishable from an ordinary payment**,
and — with the split-transaction variant — the swapped *ratio* is hidden too.
This is a **v0.2 add-on**: Class A/B must be correct and audited first; privacy
on the transparent leg is an enhancement, not a prerequisite for
trust-minimisation.

## 7. Threat model

| Adversary capability | Custodial today | This design |
|---|---|---|
| Operator/signers collude | **can steal in-flight funds** | cannot; no custody of in-flight funds |
| Operator vanishes mid-swap | funds stranded pending threshold | either leg refunds after timelock |
| Maker ghosts after taker locks | n/a | taker refunds after `t`; maker posts collateral (§8) |
| Chain reorg on the fast leg | — | timelock margin `Δ` must exceed max plausible reorg; **[AUDIT-4]** |
| Griefing (lock and never proceed) | — | mitigated per §8 |
| Break Schnorr/DL, Monero ring sig | out of scope | out of scope (assumed hard) |

**Explicitly out of scope / assumed:** the security of secp256k1 and Monero
consensus, the correctness of the underlying node RPCs, and side-channels in the
signing hosts. The Proof Layer's Sentinel circuit-breaker and transparency log
remain as **defence-in-depth and public accountability**, not as the primary
safety mechanism.

## 8. Griefing and bribery mitigations (4-Swap, arXiv:2508.04641)

HTLC/PTLC swaps are vulnerable to griefing (a party locks and stalls, freezing
the counterparty's capital until timeout) and to bribery of miners to suppress a
refund. Mitigations to specify and audit:

- **Maker collateral.** The maker posts a bond, forfeited to the taker if the
  maker fails to complete within the window — compensating the taker's gas and
  opportunity cost and deterring repeat ghosting (arXiv:2503.12719 §4.4).
- **Four-transaction structure** (4-Swap) to remove the griefing and
  bribery incentives present in the naive two-lock design; the auditor should
  compare the naive PTLC flow (§4) against the 4-Swap hardening and recommend
  which Umbra adopts. **[AUDIT-5]**
- **Reputation** via the existing transparency log: a maker's completion history
  is already publicly attestable, so takers can prefer high-reputation makers.

## 9. Migration from the custodial core

1. Ship Class A/B on **testnet only**, behind a feature flag, alongside the
   existing custodial path. No mainnet funds.
2. External audit of §2–§8 (the `[AUDIT-n]` items are the entry points).
3. Fix findings; re-audit deltas.
4. Mainnet with **small per-swap caps** and the Sentinel circuit-breaker armed;
   raise caps as confidence accrues.
5. Retire the custodial path per chain-pair only once its atomic path is audited
   and live. Class C stays custodial (labelled) until specified.

The FROST core (`backend/src/mpc/`) is **not** deleted: it remains for any
residual liquidity-vault operations and for Class C, and its current
single-machine-simulation status (real DKG + partial signatures still TODO) is
tracked separately — it is not on the critical path for Class A/B, which need no
threshold custody at all.

## 10. Open problems for the auditor (the `[AUDIT-n]` index)

- **[AUDIT-1]** Cross-group DLEQ between secp256k1 and Monero's ed25519 — exact
  construction, soundness, and that a party cannot lock to an unrevealed key.
- **[AUDIT-2]** Timelock ordering `t_XMR > t_BTC + Δ`: derive `Δ` from worst-case
  confirmation + reorg depth; prove no fund-loss window exists.
- **[AUDIT-3]** EVM escrow/factory contract: immutability, beneficiary-binding,
  refund path, reentrancy, and that a leaked witness only ever pays the intended
  party.
- **[AUDIT-4]** Reorg resistance of the fast leg vs the timelock margin.
- **[AUDIT-5]** Naive PTLC vs 4-Swap: which structure Umbra adopts and why.
- **[AUDIT-6]** Monero one-time-VES construction against current consensus rules
  (the highest-risk item — Monero's lack of scripting makes this bespoke).

---

*Written 2026-07-15 as a pre-audit design document. Sources: J. Gugger,
"Bitcoin–Monero Cross-Chain Atomic Swap" (2020); Francolla & Shah, "Enabling
High-Frequency Trading … Pre-Signing Adaptor Signatures" (arXiv:2503.12719);
Kurbatov et al., "Multichain Taprootized Atomic Swaps" (arXiv:2402.16735);
"4-Swap" (arXiv:2508.04641); You et al., "Multi-Party, Multi-Blockchain Atomic
Swap … Universal Adaptor Secret" (arXiv:2406.16822). No code implements this
document yet, by design.*
