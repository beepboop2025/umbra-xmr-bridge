'use client';

import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Copy,
  Pin,
  GitCommitHorizontal,
  Eye,
  ReceiptText,
  Check,
  X,
  Atom,
} from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton, SkeletonTable } from '@/components/ui/Skeleton';
import { Table, type Column } from '@/components/ui/Table';
import { useApi } from '@/hooks/useApi';
import { useUIStore } from '@/stores/ui-store';
import { cn, copyToClipboard, formatDate, formatTime, truncateHash } from '@/lib/utils';
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

function CopyButton({ value, label }: { value: string; label: string }) {
  const addToast = useUIStore((s) => s.addToast);
  return (
    <button
      onClick={() => {
        copyToClipboard(value).then(() =>
          addToast({ type: 'success', title: 'Copied', message: label })
        );
      }}
      className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-surface-elevated transition-colors"
      aria-label={`Copy ${label}`}
    >
      <Copy size={14} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sentinel status hero
// ---------------------------------------------------------------------------

function StatusHero() {
  const { data, error, isLoading } = useApi<ProofStatus>('/v1/proof/status', {
    refreshInterval: 15000,
  });

  if (isLoading && !data) {
    return (
      <Card padding="lg">
        <Skeleton className="h-10 w-64 mb-3" />
        <Skeleton className="h-4 w-96" />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card padding="lg" className="border-yellow-500/30 bg-yellow-500/5">
        <div className="flex items-center gap-4">
          <ShieldAlert size={36} className="shrink-0 text-yellow-400" />
          <div>
            <p className="text-xl font-bold text-yellow-400">STATUS UNAVAILABLE</p>
            <p className="text-sm text-gray-400 mt-1">
              Could not reach /v1/proof/status. The sentinel state cannot be confirmed right
              now — treat this as a reason for caution, not comfort.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const accepting = data.accepting_orders;

  return (
    <Card
      padding="lg"
      className={cn(
        accepting ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {accepting ? (
          <ShieldCheck size={44} className="shrink-0 text-green-400" />
        ) : (
          <ShieldX size={44} className="shrink-0 text-red-400" />
        )}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <p
              className={cn(
                'text-2xl sm:text-3xl font-bold tracking-tight',
                accepting ? 'text-green-400' : 'text-red-400'
              )}
            >
              {accepting ? 'ACCEPTING ORDERS' : 'INTAKE PAUSED'}
            </p>
            <Badge variant={accepting ? 'success' : 'error'} dot pulse>
              Live
            </Badge>
          </div>
          {accepting ? (
            <p className="text-sm text-gray-400 mt-1">
              The drain-guard sentinel has not tripped. Every new order is being accepted and
              receipted.
            </p>
          ) : (
            data.paused && (
              <div className="text-sm text-gray-300 mt-2 space-y-0.5">
                <p>
                  <span className="text-gray-500">Reason:</span> {data.paused.reason}
                </p>
                <p className="text-gray-500 text-xs">
                  Check <span className="font-mono">{data.paused.check}</span> tripped by{' '}
                  {data.paused.actor} at {formatDate(data.paused.tripped_at)}
                </p>
              </div>
            )
          )}
        </div>
      </div>

      {data.recent_events.length > 0 && (
        <div className="mt-5 pt-4 border-t border-surface-border">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Recent sentinel events
          </h3>
          <ul className="space-y-2">
            {data.recent_events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 text-sm">
                <Badge
                  variant={event.kind === 'trip' || event.kind === 'pause' ? 'error' : 'default'}
                  size="sm"
                  className="shrink-0 mt-0.5"
                >
                  {event.kind}
                </Badge>
                <div className="min-w-0">
                  <p className="text-gray-300">
                    <span className="font-mono text-xs text-gray-400">{event.check_name}</span>{' '}
                    — {event.reason}
                  </p>
                  <p className="text-xs text-gray-500">
                    {event.actor} · {formatTime(event.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Latest checkpoint
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

  return (
    <Card>
      <CardHeader
        title="Latest Checkpoint"
        subtitle="The bridge's most recent signed commitment to its audit log"
      />
      {isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      ) : error || !data ? (
        <p className="text-sm text-gray-500">Could not load the latest checkpoint.</p>
      ) : (
        <>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-400">Tree size</dt>
              <dd className="font-mono text-white">
                {data.checkpoint.tree_size.toLocaleString()} entries
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-400">Root hash</dt>
              <dd className="flex items-center gap-1 font-mono text-white">
                {truncateHash(data.checkpoint.root_hash, 10)}
                <CopyButton value={data.checkpoint.root_hash} label="Root hash" />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-400">Sealed at</dt>
              <dd className="text-white">{formatDate(data.checkpoint.sealed_at)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-400">Key ID</dt>
              <dd className="font-mono text-white">{data.checkpoint.key_id}</dd>
            </div>
          </dl>

          <div className="mt-4 pt-4 border-t border-surface-border">
            <Button
              variant="outline"
              size="sm"
              icon={<ShieldCheck size={14} />}
              onClick={runVerify}
              loading={verifying}
            >
              Verify signature in your browser
            </Button>

            {verdict && (
              <ul className="mt-3 space-y-1 text-sm">
                <li className="flex items-baseline gap-2">
                  {verdict.signatureValid ? (
                    <Check size={14} className="shrink-0 translate-y-0.5 text-green-400" />
                  ) : (
                    <X size={14} className="shrink-0 translate-y-0.5 text-red-400" />
                  )}
                  <span className={verdict.signatureValid ? 'text-gray-300' : 'text-red-400'}>
                    Ed25519 signature valid over the rebuilt tree head
                  </span>
                </li>
                <li className="flex items-baseline gap-2">
                  {verdict.canonicalMatches ? (
                    <Check size={14} className="shrink-0 translate-y-0.5 text-green-400" />
                  ) : (
                    <X size={14} className="shrink-0 translate-y-0.5 text-red-400" />
                  )}
                  <span className={verdict.canonicalMatches ? 'text-gray-300' : 'text-red-400'}>
                    Server canonical form matches local reconstruction
                  </span>
                </li>
                {verdict.pinMatches !== null && (
                  <li className="flex items-baseline gap-2">
                    {verdict.pinMatches ? (
                      <Check size={14} className="shrink-0 translate-y-0.5 text-green-400" />
                    ) : (
                      <X size={14} className="shrink-0 translate-y-0.5 text-red-400" />
                    )}
                    <span className={verdict.pinMatches ? 'text-gray-300' : 'text-red-400'}>
                      {verdict.pinMatches
                        ? 'Signed by your pinned key'
                        : 'Signed by a DIFFERENT key than your pin'}
                    </span>
                  </li>
                )}
                {verdict.hasPqSignature && (
                  <li className="pt-1">
                    <span
                      title="This checkpoint also carries an ML-DSA-65 (FIPS 204) post-quantum signature, verified server-side and by offline tools."
                      className="cursor-help"
                    >
                      <Badge variant="info" size="sm">
                        <Atom size={12} />
                        Post-quantum protected
                      </Badge>
                    </span>
                  </li>
                )}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Canary
// ---------------------------------------------------------------------------

function canaryFreshness(issuedAt: string): { variant: 'success' | 'warning' | 'error'; label: string } {
  const ageHours = (Date.now() - new Date(issuedAt).getTime()) / 3_600_000;
  if (ageHours < 24) return { variant: 'success', label: 'Fresh (< 24h)' };
  if (ageHours < 72) return { variant: 'warning', label: 'Aging (< 72h)' };
  return { variant: 'error', label: 'STALE — investigate' };
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

  return (
    <Card>
      <CardHeader
        title="Warrant Canary"
        subtitle="A signed, dated statement that must keep appearing"
        action={
          data ? (
            <Badge variant={canaryFreshness(data.issued_at).variant} dot>
              {canaryFreshness(data.issued_at).label}
            </Badge>
          ) : undefined
        }
      />
      {isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : error || !data ? (
        <p className="text-sm text-red-400">
          The canary could not be fetched. A missing canary is itself a signal — investigate
          before using the bridge.
        </p>
      ) : (
        <>
          <blockquote className="text-sm text-gray-300 border-l-2 border-xmr-500/50 pl-3 italic">
            {data.statement}
          </blockquote>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-400">Issued at</dt>
              <dd className="text-white">{formatDate(data.issued_at)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-400">Anchored to root</dt>
              <dd className="font-mono text-white">
                {truncateHash(data.latest_root_hash, 8)} @ {data.latest_tree_size.toLocaleString()}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-400">Signature</dt>
              <dd>
                {signatureOk === null ? (
                  <span className="text-gray-500">verifying…</span>
                ) : signatureOk ? (
                  <span className="inline-flex items-center gap-1 text-green-400">
                    <Check size={14} /> verified in your browser
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-400">
                    <X size={14} /> INVALID — do not trust
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bridge keys
// ---------------------------------------------------------------------------

function KeysCard() {
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
    <Card>
      <CardHeader
        title="Bridge Signing Keys"
        subtitle="Every receipt and checkpoint must trace back to these"
      />
      {isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : error || !data ? (
        <p className="text-sm text-gray-500">Could not load the bridge keys.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {data.algorithm} · key {data.key_id}
              </span>
              <CopyButton value={data.public_key} label="Ed25519 public key" />
            </div>
            <p className="font-mono text-xs text-gray-300 break-all bg-surface-elevated rounded-lg p-3 border border-surface-border">
              {data.public_key}
            </p>
          </div>

          {data.pq_public_key && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <Atom size={12} className="text-blue-400" />
                  {data.pq_algorithm} · key {data.pq_key_id}
                </span>
                <CopyButton value={data.pq_public_key} label="Post-quantum public key" />
              </div>
              <div className="max-h-24 overflow-y-auto font-mono text-xs text-gray-300 break-all bg-surface-elevated rounded-lg p-3 border border-surface-border">
                {data.pq_public_key}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                ML-DSA-65 signatures are archival: they protect the log against a future
                quantum adversary and are verified server-side and by offline tools.
              </p>
            </div>
          )}

          <div className="pt-3 border-t border-surface-border flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Pinning stores the Ed25519 key in your browser; the Verify page then rejects
              anything signed by a different key.
            </p>
            <Button
              variant={isPinned ? 'secondary' : 'outline'}
              size="sm"
              icon={<Pin size={14} />}
              onClick={pinKey}
              disabled={isPinned}
            >
              {isPinned ? 'Pinned' : 'Pin this key'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Checkpoint history
// ---------------------------------------------------------------------------

function CheckpointHistory() {
  const { data, error, isLoading } = useApi<Checkpoint[]>('/v1/proof/checkpoints?limit=20', {
    refreshInterval: 60000,
  });

  const columns: Column<Checkpoint>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '80px',
      render: (cp) => <span className="font-mono text-sm text-gray-400">#{cp.id}</span>,
    },
    {
      key: 'tree_size',
      header: 'Tree size',
      align: 'right',
      render: (cp) => (
        <span className="font-mono text-sm text-white">{cp.tree_size.toLocaleString()}</span>
      ),
    },
    {
      key: 'root_hash',
      header: 'Root hash',
      render: (cp) => (
        <span className="inline-flex items-center gap-1 font-mono text-sm text-gray-300">
          {truncateHash(cp.root_hash, 8)}
          <CopyButton value={cp.root_hash} label="Root hash" />
        </span>
      ),
    },
    {
      key: 'key_id',
      header: 'Key',
      render: (cp) => <span className="font-mono text-xs text-gray-500">{cp.key_id}</span>,
    },
    {
      key: 'sealed_at',
      header: 'Sealed',
      align: 'right',
      render: (cp) => <span className="text-sm text-gray-400">{formatTime(cp.sealed_at)}</span>,
    },
  ];

  return (
    <Card padding="none">
      <div className="p-5 pb-0">
        <CardHeader
          title="Checkpoint History"
          subtitle="Each root must extend the previous — a rewritten history cannot"
        />
      </div>
      {isLoading && !data ? (
        <div className="p-5 pt-0">
          <SkeletonTable rows={5} cols={5} />
        </div>
      ) : error ? (
        <p className="p-5 pt-0 text-sm text-gray-500">Could not load checkpoint history.</p>
      ) : (
        <Table
          data={data || []}
          columns={columns}
          emptyMessage="No checkpoints sealed yet"
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Explainers
// ---------------------------------------------------------------------------

const explainers = [
  {
    icon: GitCommitHorizontal,
    title: 'What is a checkpoint?',
    body: 'Every receipt the bridge issues is appended to a Merkle tree. A checkpoint is a signed snapshot of that tree: its size, its root hash, and the previous root. Because each checkpoint commits to the one before it, the bridge cannot quietly rewrite or delete history — any fork would produce two signed checkpoints that contradict each other, and either one is proof of misbehavior.',
  },
  {
    icon: Eye,
    title: 'What does the sentinel watch?',
    body: 'The drain-guard sentinel continuously compares hot-wallet outflows, order volume, and receipt issuance against hard limits. If withdrawals outpace what signed receipts can account for — the signature of an operator gone rogue or a compromised server — it halts order intake automatically and records why. The pause state and every trip event are published here, not hidden in an internal dashboard.',
  },
  {
    icon: ReceiptText,
    title: 'Why do receipts matter?',
    body: 'A bridge that says "trust us" is asking you to hope. A signed receipt is different: it is a cryptographic commitment to the exact terms of your swap — amounts, rate, fee, and transaction hashes — chained to every other receipt for the order. If the bridge later disputes what it owed you, the receipt is portable proof that anyone can verify without trusting this website, using the offline verifier.',
  },
];

function Explainers() {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {explainers.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.title}>
            <div className="flex items-center gap-2 mb-2">
              <Icon size={18} className="text-xmr-400" />
              <h3 className="text-sm font-semibold text-white">{item.title}</h3>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">{item.body}</p>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TransparencyPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Transparency</h1>
        <p className="text-gray-400 mt-2">
          The bridge&apos;s live proof layer: sentinel status, signed checkpoints, and the
          warrant canary. Signatures shown as verified are checked in your browser, never
          taken on faith.
        </p>
      </div>

      <StatusHero />

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <LatestCheckpointCard />
        <CanaryCard />
      </div>

      <div className="mt-6">
        <KeysCard />
      </div>

      <div className="mt-6">
        <CheckpointHistory />
      </div>

      <div className="mt-8">
        <Explainers />
      </div>

      <div className="mt-8 text-center text-sm text-gray-600">
        <p>
          Verify any order&apos;s receipts on the{' '}
          <a href="/verify" className="text-xmr-400 hover:text-xmr-300">
            Verify page
          </a>{' '}
          — or download the offline verifier and trust nothing but the math.
        </p>
      </div>
    </div>
  );
}
