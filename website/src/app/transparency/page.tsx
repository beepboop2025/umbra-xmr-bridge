'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  ShieldAlert,
  Activity,
  GitCommitHorizontal,
  Eye,
  ReceiptText,
  Copy,
  Pin,
  Atom,
  Check,
  X,
  Minus,
  KeyRound,
  ScrollText,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useUIStore } from '@/stores/ui-store';
import { copyToClipboard, formatDate, formatTime, truncateHash } from '@/lib/utils';
import { Chip, DecisionCard, Panel, Provenance, TrustStrip } from '@/components/tikto/primitives';
import { Reveal, Stagger, StaggerItem, NumberRoll } from '@/components/tikto/motion';
import {
  verifyCheckpoint,
  verifyCanary,
  getStoredPinnedKey,
  storePinnedKey,
  type Canary,
  type Checkpoint,
  type CheckpointEnvelope,
  type CheckpointVerdict,
  type ProofKey,
  type ProofStatus,
} from '@/lib/proof';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const API_HOST = (() => {
  try {
    return new URL(API_BASE).host;
  } catch {
    return API_BASE;
  }
})();

type RowTone = 'ok' | 'critical' | 'watch' | 'stale';

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function CopyButton({ value, label }: { value: string; label: string }) {
  const addToast = useUIStore((s) => s.addToast);
  return (
    <button
      onClick={() =>
        copyToClipboard(value).then(() =>
          addToast({ type: 'success', title: 'Copied', message: label })
        )
      }
      className="p-1 rounded-md text-ink-3 hover:text-live-500 hover:bg-surface-elevated transition-colors"
      aria-label={`Copy ${label}`}
    >
      <Copy size={13} />
    </button>
  );
}

/** One glass-box verification step: icon + colour + text, never colour alone. */
function CheckRow({ ok, tone, children }: { ok?: boolean; tone?: RowTone; children: ReactNode }) {
  const t: RowTone = tone ?? (ok ? 'ok' : 'critical');
  const color = `var(--tk-${t})`;
  const Icon = t === 'ok' ? Check : t === 'critical' ? X : t === 'watch' ? Atom : Minus;
  const textColor =
    t === 'critical' ? 'var(--tk-critical)' : t === 'stale' ? 'var(--tk-text-3)' : 'var(--tk-text-2)';
  return (
    <li className="flex items-baseline gap-2 text-[13px]">
      <Icon size={14} className="shrink-0 translate-y-0.5" style={{ color }} />
      <span style={{ color: textColor }}>{children}</span>
    </li>
  );
}

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="tk-label" style={{ margin: 0 }}>
        {k}
      </dt>
      <dd className="font-mono text-[13px] text-ink-1 flex items-center gap-1">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sentinel status — the hero decision
// ---------------------------------------------------------------------------

function eventLevel(kind: string): RowTone {
  return kind === 'trip' || kind === 'pause' ? 'critical' : kind === 'resume' ? 'ok' : 'watch';
}

function StatusHero() {
  const { data, error, isLoading } = useApi<ProofStatus>('/v1/proof/status', {
    refreshInterval: 15000,
  });

  if (isLoading && !data) {
    return (
      <div className="tk-card">
        <div className="shimmer h-9 w-56 rounded-md" />
        <div className="shimmer h-4 w-80 rounded-md mt-3" />
      </div>
    );
  }

  // Fail loud: an unconfirmable sentinel is a reason for caution, never comfort.
  if (error || !data) {
    return (
      <DecisionCard tone="critical" title={<><ShieldAlert size={14} /> Intake sentinel</>} chip={<Chip tone="stale">unreachable</Chip>}>
        <div className="tk-hero">
          <span className="tk-hero__value tk-hero__value--degraded" style={{ fontSize: 'clamp(28px,5vw,40px)' }}>
            UNKNOWN
          </span>
        </div>
        <div className="tk-degraded">
          <ShieldAlert size={15} /> Could not reach /v1/proof/status. The sentinel state cannot be
          confirmed right now. Treat this as a reason for caution.
        </div>
      </DecisionCard>
    );
  }

  const accepting = data.accepting_orders;
  const tone: RowTone = accepting ? 'ok' : 'critical';

  return (
    <DecisionCard
      tone={tone}
      title={<><Activity size={14} /> Intake sentinel · drain-guard</>}
      chip={<Chip tone={tone}>● live</Chip>}
    >
      <div className="tk-hero">
        <span
          className="tk-hero__value"
          style={{ color: `var(--tk-${tone})`, fontSize: 'clamp(28px,5.2vw,44px)' }}
        >
          {accepting ? 'ACCEPTING' : 'PAUSED'}
        </span>
        {accepting ? (
          <ShieldCheck size={26} style={{ color: 'var(--tk-ok)' }} />
        ) : (
          <ShieldAlert size={26} style={{ color: 'var(--tk-critical)' }} />
        )}
      </div>

      {accepting ? (
        <div className="tk-comprehend">
          The drain-guard sentinel has not tripped. Every new order is accepted and receipted.
        </div>
      ) : (
        data.paused && (
          <>
            <div className="tk-comprehend" style={{ color: 'var(--tk-critical)' }}>
              {data.paused.reason}
            </div>
            <div className="tk-project font-mono">
              check {data.paused.check} · tripped by {data.paused.actor} · {formatDate(data.paused.tripped_at)}
            </div>
          </>
        )
      )}

      {data.recent_events.length > 0 && (
        <div className="mt-5 pt-4 border-t border-surface-border">
          <div className="tk-label mb-3">Recent sentinel events</div>
          <div className="tk-alarms">
            {data.recent_events.map((event) => {
              const lvl = eventLevel(event.kind);
              return (
                <div key={event.id} className={`tk-alarm tk-alarm--${lvl === 'ok' ? 'watch' : lvl}`}>
                  <Chip tone={lvl}>{event.kind}</Chip>
                  <div>
                    <div className="tk-alarm__msg">
                      <span className="font-mono text-ink-2">{event.check_name}</span> — {event.reason}
                    </div>
                    <div className="tk-alarm__meta">{event.actor}</div>
                  </div>
                  <span className="font-mono text-[10.5px] text-ink-3 whitespace-nowrap">
                    {formatTime(event.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </DecisionCard>
  );
}

// ---------------------------------------------------------------------------
// Latest checkpoint — the newest signed commitment
// ---------------------------------------------------------------------------

function LatestCheckpointCard() {
  const { data, error, isLoading } = useApi<CheckpointEnvelope>('/v1/proof/checkpoint/latest', {
    refreshInterval: 60000,
  });
  const [verdict, setVerdict] = useState<CheckpointVerdict | null>(null);
  const [verifying, setVerifying] = useState(false);

  const runVerify = async () => {
    if (!data) return;
    setVerifying(true);
    try {
      setVerdict(await verifyCheckpoint(data, getStoredPinnedKey()));
    } finally {
      setVerifying(false);
    }
  };

  const cp = data?.checkpoint;

  return (
    <DecisionCard
      tone={verdict ? (verdict.ok ? 'ok' : 'critical') : 'watch'}
      title={<><GitCommitHorizontal size={14} /> Latest checkpoint</>}
      chip={<Chip tone="watch">signed head</Chip>}
    >
      {isLoading && !cp ? (
        <div className="space-y-3">
          <div className="shimmer h-10 w-40 rounded-md" />
          <div className="shimmer h-4 w-full rounded-md" />
        </div>
      ) : error || !cp ? (
        <div className="tk-degraded">
          <ShieldAlert size={15} /> Could not load the latest checkpoint.
        </div>
      ) : (
        <>
          <div className="tk-hero">
            <NumberRoll
              className="tk-hero__value"
              value={cp.tree_size}
              format={(v) => Math.round(v).toLocaleString()}
            />
            <span className="tk-hero__unit">entries</span>
          </div>
          <div className="tk-comprehend">
            The bridge&apos;s most recent signed commitment to its audit log, sealed{' '}
            {formatTime(cp.sealed_at)}.
          </div>

          <dl className="mt-4 space-y-2.5">
            <KV k="root hash">
              <Provenance
                rows={[
                  { k: 'root_hash', v: truncateHash(cp.root_hash, 10) },
                  { k: 'prev_root', v: truncateHash(cp.prev_root_hash, 10) },
                  { k: 'tree_size', v: cp.tree_size.toLocaleString() },
                  { k: 'leaf hash', v: 'SHA-256(0x00 ‖ receipt)' },
                  { k: 'node hash', v: 'SHA-256(0x01 ‖ L ‖ R)' },
                  { k: 'chaining', v: 'each head commits prev_root_hash' },
                  { k: 'scheme', v: 'RFC 6962 Merkle' },
                ]}
              >
                <span className="font-mono text-ink-1">{truncateHash(cp.root_hash, 10)}</span>
              </Provenance>
              <CopyButton value={cp.root_hash} label="Root hash" />
            </KV>
            <KV k="prev root">{truncateHash(cp.prev_root_hash, 10)}</KV>
            <KV k="key id">{cp.key_id}</KV>
            <KV k="sealed at">{formatDate(cp.sealed_at)}</KV>
          </dl>

          <div className="mt-4 pt-4 border-t border-surface-border">
            <button className="tk-btn" onClick={runVerify} disabled={verifying}>
              <ShieldCheck size={14} /> {verifying ? 'Verifying…' : 'Verify signature in your browser'}
            </button>

            {verdict && (
              <ul className="mt-3 space-y-1.5">
                <CheckRow ok={verdict.signatureValid}>
                  Ed25519 signature valid over the rebuilt tree head
                </CheckRow>
                <CheckRow ok={verdict.canonicalMatches}>
                  Server canonical form matches local reconstruction
                </CheckRow>
                {verdict.pinMatches !== null && (
                  <CheckRow ok={verdict.pinMatches}>
                    {verdict.pinMatches
                      ? 'Signed by your pinned key'
                      : 'Signed by a DIFFERENT key than your pin'}
                  </CheckRow>
                )}
                <CheckRow tone={verdict.hasPqSignature ? 'watch' : 'stale'} ok={verdict.hasPqSignature}>
                  {verdict.hasPqSignature
                    ? 'ML-DSA-65 post-quantum signature attached · verify offline'
                    : 'No post-quantum signature attached'}
                </CheckRow>
                {!verdict.ok && (
                  <li className="tk-degraded">
                    <ShieldAlert size={15} /> This checkpoint did not verify. Do not trust it.
                  </li>
                )}
              </ul>
            )}
          </div>
        </>
      )}
    </DecisionCard>
  );
}

// ---------------------------------------------------------------------------
// Warrant canary
// ---------------------------------------------------------------------------

function canaryFreshness(issuedAt: string): { tone: RowTone; label: string } {
  const ageHours = (Date.now() - new Date(issuedAt).getTime()) / 3_600_000;
  if (ageHours < 24) return { tone: 'ok', label: 'fresh · < 24h' };
  if (ageHours < 72) return { tone: 'watch', label: 'aging · < 72h' };
  return { tone: 'critical', label: 'stale · investigate' };
}

function CanaryCard() {
  const { data, error, isLoading } = useApi<Canary>('/v1/proof/canary', {
    refreshInterval: 60000,
  });
  const [signatureOk, setSignatureOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    verifyCanary(data).then((ok) => {
      if (!cancelled) setSignatureOk(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const fresh = data ? canaryFreshness(data.issued_at) : null;

  return (
    <DecisionCard
      tone={error || !data ? 'critical' : signatureOk === false ? 'critical' : fresh?.tone}
      title={<><Eye size={14} /> Warrant canary</>}
      chip={fresh ? <Chip tone={fresh.tone}>{fresh.label}</Chip> : undefined}
    >
      {isLoading && !data ? (
        <div className="space-y-3">
          <div className="shimmer h-4 w-full rounded-md" />
          <div className="shimmer h-4 w-3/4 rounded-md" />
        </div>
      ) : error || !data ? (
        <div className="tk-degraded">
          <ShieldAlert size={15} /> The canary could not be fetched. A missing canary is itself a
          signal. Investigate before using the bridge.
        </div>
      ) : (
        <>
          <blockquote
            className="text-[13.5px] text-ink-1 italic pl-3 leading-relaxed"
            style={{ borderLeft: '2px solid var(--tk-live-dim)' }}
          >
            {data.statement}
          </blockquote>
          <dl className="mt-4 space-y-2.5">
            <KV k="issued at">{formatDate(data.issued_at)}</KV>
            <KV k="anchored root">
              {truncateHash(data.latest_root_hash, 8)} @ {data.latest_tree_size.toLocaleString()}
            </KV>
          </dl>
          <ul className="mt-3 pt-3 border-t border-surface-border">
            {signatureOk === null ? (
              <CheckRow tone="stale">verifying signature…</CheckRow>
            ) : (
              <CheckRow ok={signatureOk}>
                {signatureOk
                  ? 'Ed25519 signature verified in your browser'
                  : 'Signature INVALID — do not trust'}
              </CheckRow>
            )}
          </ul>
        </>
      )}
    </DecisionCard>
  );
}

// ---------------------------------------------------------------------------
// Bridge signing keys — the public proof key
// ---------------------------------------------------------------------------

function KeysPanel() {
  const { data, error, isLoading } = useApi<ProofKey>('/v1/proof/key');
  const addToast = useUIStore((s) => s.addToast);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);

  useEffect(() => {
    setPinnedKey(getStoredPinnedKey());
  }, []);

  const pinKey = () => {
    if (!data) return;
    storePinnedKey(data.public_key);
    setPinnedKey(data.public_key.toLowerCase());
    addToast({
      type: 'success',
      title: 'Key pinned',
      message: 'The Verify page will now require every signature to come from this key.',
    });
  };

  const isPinned = data ? pinnedKey === data.public_key.toLowerCase() : false;

  return (
    <Panel
      title={<><KeyRound size={13} className="inline mr-1.5 -translate-y-px" /> Bridge signing keys</>}
      right={<span className="tk-label">every receipt & checkpoint traces here</span>}
    >
      {isLoading && !data ? (
        <div className="space-y-3">
          <div className="shimmer h-4 w-full rounded-md" />
          <div className="shimmer h-16 w-full rounded-md" />
        </div>
      ) : error || !data ? (
        <div className="tk-degraded">
          <ShieldAlert size={15} /> Could not load the bridge keys.
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="tk-label" style={{ color: 'var(--tk-live)' }}>
                {data.algorithm} · key {data.key_id}
              </span>
              <CopyButton value={data.public_key} label="Ed25519 public key" />
            </div>
            <p className="font-mono text-[11.5px] text-ink-2 break-all rounded-md p-3 bg-surface-elevated border border-surface-border">
              {data.public_key}
            </p>
          </div>

          {data.pq_public_key && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="tk-label inline-flex items-center gap-1.5">
                  <Atom size={12} style={{ color: 'var(--tk-watch)' }} />
                  {data.pq_algorithm} · key {data.pq_key_id}
                </span>
                <CopyButton value={data.pq_public_key} label="Post-quantum public key" />
              </div>
              <div className="max-h-24 overflow-y-auto font-mono text-[11.5px] text-ink-2 break-all rounded-md p-3 bg-surface-elevated border border-surface-border">
                {data.pq_public_key}
              </div>
              <p className="text-[11px] text-ink-3 mt-1.5 leading-relaxed">
                ML-DSA-65 signatures are archival: they protect the log against a future quantum
                adversary and are verified server-side and by offline tools.
              </p>
            </div>
          )}

          <div className="pt-3 border-t border-surface-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-ink-3">
              <span>canon <b className="text-ink-1 font-semibold">{data.canonicalization}</b></span>
              <span>receipt <b className="text-ink-1 font-semibold">{data.receipt_version}</b></span>
            </div>
            <button
              className={`tk-btn ${isPinned ? '' : 'tk-btn--live'}`}
              onClick={pinKey}
              disabled={isPinned}
            >
              <Pin size={14} /> {isPinned ? 'Pinned' : 'Pin this key'}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Transparency log — the stream of signed checkpoints
// ---------------------------------------------------------------------------

function TransparencyLog() {
  const { data, error, isLoading } = useApi<Checkpoint[]>('/v1/proof/checkpoints?limit=20', {
    refreshInterval: 60000,
  });

  return (
    <Panel
      title={<><ScrollText size={13} className="inline mr-1.5 -translate-y-px" /> Transparency log</>}
      right={
        data ? (
          <Chip tone="ok">{data.length} checkpoints</Chip>
        ) : (
          <span className="tk-label">signed history</span>
        )
      }
    >
      {isLoading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="shimmer h-14 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        /* Fail loud: an unreachable log means the bridge's history is unconfirmable. */
        <div className="tk-degraded">
          <ShieldAlert size={15} /> Transparency log unavailable. The bridge&apos;s history cannot be
          confirmed right now.
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-[13px] text-ink-3 py-4">No checkpoints sealed yet.</p>
      ) : (
        <div className="tk-stream">
          {data.map((cp, i) => (
            <div key={cp.id} className="tk-stream__item" data-level={i === 0 ? 'watch' : undefined}>
              <div className="tk-stream__head">
                <span className="font-mono text-ink-2">
                  #{cp.id} · <b className="text-ink-0">{cp.tree_size.toLocaleString()}</b> entries
                  {i === 0 && <span className="text-live-500"> · latest</span>}
                </span>
                <span className="font-mono text-ink-3">{formatTime(cp.sealed_at)}</span>
              </div>
              <div className="tk-stream__text font-mono flex items-center gap-1.5">
                <span className="text-ink-3">root</span>
                <span className="text-ink-1">{truncateHash(cp.root_hash, 10)}</span>
                <CopyButton value={cp.root_hash} label="Root hash" />
                <span className="text-ink-4 ml-auto">key {cp.key_id}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-4 mt-3 font-mono">
        retain checkpoints and verify consistency proofs to test append-only history
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Explainers
// ---------------------------------------------------------------------------

const explainers = [
  {
    icon: GitCommitHorizontal,
    title: 'What is a checkpoint?',
    body: 'Recorded receipts are appended to a Merkle tree. A checkpoint is a signed snapshot containing the tree size and root hash. A verifier that retains or independently witnesses checkpoints can request consistency proofs and detect contradictory signed views.',
  },
  {
    icon: Eye,
    title: 'What does the sentinel watch?',
    body: 'The Sentinel compares configured hot-wallet outflow, order-volume, and receipt-issuance metrics with thresholds. Its intended response is to pause new intake and record the trip reason. This page reports the status returned by the service; an unreachable endpoint leaves that status unconfirmed.',
  },
  {
    icon: ReceiptText,
    title: 'Why do receipts matter?',
    body: 'A signed receipt commits the service key to the recorded terms of a swap. With a trusted public key and the relevant checkpoints, it can be verified outside this website. It does not by itself prove off-log events, key custody, or correct settlement.',
  },
];

function Explainers() {
  return (
    <Stagger className="grid md:grid-cols-3 gap-4">
      {explainers.map((item) => {
        const Icon = item.icon;
        return (
          <StaggerItem key={item.title}>
            <div className="tk-panel h-full">
              <div className="flex items-center gap-2 mb-2.5">
                <Icon size={17} className="text-live-500" />
                <h3 className="text-[14px] font-bold text-ink-0">{item.title}</h3>
              </div>
              <p className="text-[13px] text-ink-2 leading-relaxed">{item.body}</p>
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TransparencyPage() {
  const { data: latest } = useApi<CheckpointEnvelope>('/v1/proof/checkpoint/latest', {
    refreshInterval: 60000,
  });
  const { data: key } = useApi<ProofKey>('/v1/proof/key');

  const cp = latest?.checkpoint;
  const trustItems = [
    { label: 'as of', value: cp ? formatTime(cp.sealed_at) : '——', dot: 'var(--tk-ok)' },
    { label: 'tree', value: cp ? cp.tree_size.toLocaleString() : '——' },
    { label: 'root', value: cp ? truncateHash(cp.root_hash, 6) : '——' },
    { label: 'key', value: key ? key.key_id : '——' },
    { label: 'env', value: API_HOST },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-12">
      {/* Trust strip — auditability always visible */}
      <TrustStrip items={trustItems} />

      <Reveal className="mt-8 mb-8">
        <div className="flex items-center gap-2.5 mb-2">
          <ShieldCheck size={22} className="text-live-500" />
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink-0">Transparency</h1>
        </div>
        <p className="text-ink-2 max-w-2xl leading-relaxed">
          Current proof-layer data: Sentinel status, signed checkpoints, the public key,
          and the warrant canary. Signature checks shown by this page run in the browser;
          key identity and checkpoint witnessing remain separate trust decisions.
        </p>
      </Reveal>

      <Reveal>
        <StatusHero />
      </Reveal>

      <Reveal className="mt-6">
        <div className="grid lg:grid-cols-2 gap-6">
          <LatestCheckpointCard />
          <CanaryCard />
        </div>
      </Reveal>

      <Reveal className="mt-6">
        <KeysPanel />
      </Reveal>

      <Reveal className="mt-6">
        <TransparencyLog />
      </Reveal>

      <Reveal className="mt-10">
        <Explainers />
      </Reveal>

      <div className="mt-10 text-center text-[13px] text-ink-3">
        <p>
          Verify any order&apos;s receipts on the{' '}
          <Link href="/verify" className="text-live-500 hover:text-live-400">
            Verify page
          </Link>{' '}
          — or download the offline verifier and trust nothing but the math.
        </p>
      </div>
    </div>
  );
}
