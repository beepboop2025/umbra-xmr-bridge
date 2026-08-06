'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ExternalLink, Clock, Shield, ShieldCheck, Copy, Check } from 'lucide-react';
import { CHAINS } from '@/lib/chains';
import { ChainIcon } from '@/components/bridge/ChainSelector';
import { DecisionCard, Hero, Chip, Provenance, Panel, TrustStrip } from '@/components/tikto/primitives';
import { Reveal } from '@/components/tikto/motion';
import { formatDate, truncateHash, getExplorerUrl, copyToClipboard } from '@/lib/utils';
import { statusMeta } from './TxList';
import type { OrderDetail } from '@/lib/api-client';

const fmt = (n: number, d = 8) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: d });

interface TxDetailProps {
  order: OrderDetail;
}

export function TxDetail({ order }: TxDetailProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const src = CHAINS[order.source_chain];
  const dst = CHAINS[order.dest_chain];
  const meta = statusMeta(order.status);
  const srcSym = src?.symbol ?? order.source_chain;
  const dstSym = dst?.symbol ?? order.dest_chain;

  const copy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 1800);
  };

  const hasSettlement = Boolean(order.source_tx || order.dest_tx);

  return (
    <div className="space-y-5">
      {/* Hero decision card — one screen, one hero number */}
      <Reveal>
        <DecisionCard
          tone={meta.tone}
          title={
            <>
              <span className="text-ink-4">order</span>
              <span className="max-w-[220px] truncate font-mono text-ink-1">{order.order_id}</span>
            </>
          }
          chip={<Chip tone={meta.tone}>{meta.label}</Chip>}
        >
          <Hero value={fmt(order.amount)} unit={srcSym} />

          {/* route — source -> dest */}
          <div className="tk-project" style={{ marginTop: 14 }}>
            <span className="inline-flex items-center gap-1.5">
              {src && <ChainIcon chain={src} size={18} />}
              <b className="text-ink-1">{src?.name ?? order.source_chain}</b>
            </span>
            <ArrowRight size={13} className="text-ink-4" />
            <span className="inline-flex items-center gap-1.5">
              {dst && <ChainIcon chain={dst} size={18} />}
              <b className="text-ink-1">{dst?.name ?? order.dest_chain}</b>
            </span>
          </div>

          {/* received — pull the number to see how it was derived */}
          <div className="tk-comprehend" style={{ marginTop: 12 }}>
            Receives{' '}
            <span className="font-mono text-live-500">
              <Provenance
                rows={[
                  { k: 'exchange rate', v: `1 ${srcSym} = ${fmt(order.rate)} ${dstSym}` },
                  { k: 'bridge fee', v: `${order.fee_percent}%` },
                  { k: 'network fee', v: `${fmt(order.network_fee)} ${dstSym}` },
                  { k: 'you receive', v: `${fmt(order.receive_amount)} ${dstSym}`, weight: 1 },
                ]}
              >
                {fmt(order.receive_amount)} {dstSym}
              </Provenance>
            </span>
          </div>

          {/* forcing function: prove it, don't just trust it */}
          <Link
            href="/verify"
            className="tk-action"
            style={{ borderStyle: 'solid', borderColor: 'var(--tk-live)', color: 'var(--tk-live)' }}
          >
            <ShieldCheck size={15} /> Verify this receipt — signed proof, checked offline
          </Link>
        </DecisionCard>
      </Reveal>

      {/* Settlement — timestamps + on-chain hashes (never addresses) */}
      <Reveal delay={0.05}>
        <Panel title="Settlement">
          <div className="flex flex-col">
            <MetaRow k="Created" v={formatDate(order.created_at)} />
            {order.completed_at && <MetaRow k="Completed" v={formatDate(order.completed_at)} />}
            {order.source_tx && (
              <TxHashRow
                label={`${srcSym} deposit`}
                chain={order.source_chain}
                hash={order.source_tx}
                copied={copied}
                onCopy={copy}
              />
            )}
            {order.dest_tx && (
              <TxHashRow
                label={`${dstSym} payout`}
                chain={order.dest_chain}
                hash={order.dest_tx}
                copied={copied}
                onCopy={copy}
              />
            )}
            {!hasSettlement && (
              <p className="py-2 text-xs text-ink-4">
                On-chain transaction hashes appear here once the swap settles.
              </p>
            )}
          </div>
        </Panel>
      </Reveal>

      {/* Trust strip — auditability always visible */}
      <Reveal delay={0.1}>
        <TrustStrip
          items={[
            { label: meta.label.toLowerCase(), dot: `var(--tk-${meta.tone})` },
            { label: 'custody', value: 'threshold 2-of-3' },
            { label: 'receipts', value: 'ed25519 + ml-dsa' },
            {
              label: (
                <Link href="/verify" style={{ color: 'var(--tk-live)' }}>
                  verify &rarr;
                </Link>
              ),
            },
          ]}
        />
      </Reveal>

      {/* Timeline */}
      {order.timeline && order.timeline.length > 0 && (
        <Reveal delay={0.12}>
          <Panel title="Timeline">
            <div className="flex flex-col">
              {order.timeline.map((event, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className="mt-1.5 h-2.5 w-2.5 rounded-full"
                      style={{ background: 'var(--tk-live)', boxShadow: '0 0 8px var(--tk-live-glow)' }}
                    />
                    {i < order.timeline.length - 1 && (
                      <div className="mt-1 w-px flex-1" style={{ background: 'var(--tk-line-2)' }} />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className="text-[13px] font-medium capitalize text-ink-1">
                      {String(event.event).replace(/_/g, ' ')}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-ink-3">
                      <Clock size={10} /> {formatDate(event.timestamp)}
                    </p>
                    {event.tx_hash && (
                      <p className="mt-1 truncate font-mono text-[11px] text-ink-4">
                        tx {truncateHash(event.tx_hash)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </Reveal>
      )}

      {/* Privacy notice */}
      <Reveal delay={0.15}>
        <div className="tk-card tk-card--ok">
          <div className="flex gap-3">
            <Shield size={20} className="shrink-0 text-ok" />
            <div>
              <p className="text-sm font-semibold text-ink-0">Public-record scope</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">
                This view omits raw deposit and destination addresses by design. Public-chain
                settlement remains observable and other metadata may still permit correlation.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-surface-border/60 py-2.5 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-ink-4">{k}</span>
      <span className="font-mono text-[13px] text-ink-1">{v}</span>
    </div>
  );
}

function TxHashRow({
  label,
  chain,
  hash,
  copied,
  onCopy,
}: {
  label: string;
  chain: string;
  hash: string;
  copied: string | null;
  onCopy: (text: string, field: string) => void;
}) {
  const isCopied = copied === label;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-surface-border/60 py-2.5 last:border-0">
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-ink-4">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <a
          href={getExplorerUrl(chain, hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-mono text-[13px] text-live-500 transition-colors hover:text-live-300"
        >
          {truncateHash(hash, 10)}
          <ExternalLink size={11} className="ml-1 inline -translate-y-px" />
        </a>
        <button
          onClick={() => onCopy(hash, label)}
          className="shrink-0 rounded p-1 text-ink-4 transition-colors hover:text-ink-2"
          aria-label={`Copy ${label} hash`}
        >
          {isCopied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

export default TxDetail;
