'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, AlertTriangle, Copy, ExternalLink, ShieldCheck, Circle } from 'lucide-react';
import { DecisionCard, Hero, Chip } from '@/components/tikto/primitives';
import type { OrderDetail, OrderStatus as OrderStatusType } from '@/lib/api-client';
import { truncateHash, formatDate, copyToClipboard, getExplorerUrl, cn } from '@/lib/utils';
import { CHAINS } from '@/lib/chains';

interface OrderStatusProps {
  order: OrderDetail;
  className?: string;
}

type Tone = 'ok' | 'watch' | 'warning' | 'critical' | 'stale';

// The signing pipeline: created → deposit detected → confirming → signing → sending → completed.
const STEPS: { key: OrderStatusType; label: string; desc: string }[] = [
  { key: 'awaiting_deposit', label: 'Awaiting deposit', desc: 'Send the exact amount to the deposit address below.' },
  { key: 'confirming', label: 'Deposit confirming', desc: 'Deposit detected — waiting for network confirmations.' },
  { key: 'exchanging', label: 'Threshold signing', desc: 'The configured 2-of-3 signing flow authorizes the withdrawal.' },
  { key: 'sending', label: 'Sending native assets', desc: 'Broadcasting real assets to your destination address.' },
  { key: 'completed', label: 'Completed', desc: 'Assets delivered. An ed25519 + ml-dsa receipt was issued.' },
];
const STEP_ORDER = STEPS.map((s) => s.key);

function getStepIndex(status: OrderStatusType): number {
  if (status === 'expired' || status === 'failed' || status === 'refunded') return -1;
  const idx = STEP_ORDER.indexOf(status);
  return idx >= 0 ? idx : 0; // 'pending' sits at the first step
}

const STATUS_LABEL: Record<OrderStatusType, string> = {
  pending: 'Pending',
  awaiting_deposit: 'Awaiting deposit',
  confirming: 'Confirming',
  exchanging: 'Signing',
  sending: 'Sending',
  completed: 'Completed',
  expired: 'Expired',
  failed: 'Failed',
  refunded: 'Refunded',
};

function statusTone(status: OrderStatusType): Tone {
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'expired') return 'critical';
  if (status === 'refunded') return 'warning';
  if (status === 'pending') return 'stale';
  return 'watch';
}

function fmtCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function OrderStatusComponent({ order, className }: OrderStatusProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(0);

  useEffect(() => {
    setNowTs(Date.now());
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const currentStep = getStepIndex(order.status);
  const isFailed = ['expired', 'failed', 'refunded'].includes(order.status);
  const tone = statusTone(order.status);

  const srcChain = CHAINS[order.source_chain];
  const dstChain = CHAINS[order.dest_chain];
  const dp = dstChain?.type === 'stablecoin' ? 2 : 6;
  const recvShown = (Number(order.receive_amount) || 0).toFixed(dp);

  const expMs = order.expires_at ? new Date(order.expires_at).getTime() : 0;
  const expiresIn = nowTs && expMs ? Math.max(0, Math.round((expMs - nowTs) / 1000)) : null;

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <DecisionCard
      tone={tone}
      className={className}
      title={<span className="tk-num">order {order.order_id}</span>}
      chip={<Chip tone={tone}>{STATUS_LABEL[order.status]}</Chip>}
    >
      {/* Hero: the outcome */}
      <Hero value={<span className="tk-num">{recvShown}</span>} unit={dstChain?.symbol} />
      <div className="tk-comprehend tk-num">
        {order.amount} {srcChain?.symbol} → {recvShown} {dstChain?.symbol}
      </div>

      {/* Fail-loud banner */}
      {isFailed && (
        <div className={cn('tk-alarm mt-4', order.status === 'refunded' ? 'tk-alarm--warning' : 'tk-alarm--critical')}>
          <AlertTriangle size={18} style={{ color: order.status === 'refunded' ? 'var(--tk-warning)' : 'var(--tk-critical)' }} />
          <div>
            <p className="tk-alarm__msg">
              {order.status === 'expired'
                ? 'Order expired — no deposit arrived in time.'
                : order.status === 'refunded'
                ? 'Order refunded to your refund address.'
                : 'Order failed while processing.'}
            </p>
            <p className="tk-alarm__meta">
              {order.status === 'refunded'
                ? 'Funds returned. You can start a new swap safely.'
                : 'No funds moved without a signed withdrawal. Start a new order or contact support.'}
            </p>
          </div>
          <Chip tone={order.status === 'refunded' ? 'warning' : 'critical'}>{STATUS_LABEL[order.status]}</Chip>
        </div>
      )}

      {/* Deposit action */}
      {order.status === 'awaiting_deposit' && (
        <div className="mt-4 rounded-[11px] border p-4" style={{ background: 'rgba(6,214,224,0.05)', borderColor: 'var(--tk-live-dim)' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="tk-label" style={{ color: 'var(--tk-live)' }}>Send exactly</span>
            {expiresIn != null && (
              <span
                className="tk-num text-[11px] font-bold"
                style={{ color: expiresIn < 300 ? 'var(--tk-warning)' : 'var(--tk-text-2)' }}
              >
                expires in {fmtCountdown(expiresIn)}
              </span>
            )}
          </div>
          <div className="tk-num text-lg font-bold text-ink-0 mt-1">
            {order.amount} {srcChain?.symbol}
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <code className="flex-1 min-w-0 text-[12px] font-mono break-all" style={{ color: 'var(--tk-live)' }}>
              {order.deposit_address}
            </code>
            <button
              onClick={() => handleCopy(order.deposit_address, 'deposit')}
              aria-label="Copy deposit address"
              className="shrink-0 p-2 rounded-lg hover:bg-surface-elevated transition-colors"
            >
              {copiedField === 'deposit' ? <Check size={14} style={{ color: 'var(--tk-ok)' }} /> : <Copy size={14} className="text-ink-3" />}
            </button>
          </div>
        </div>
      )}

      {/* Tiered pipeline */}
      {!isFailed && (
        <div className="tk-stream mt-4" style={{ maxHeight: 'none' }}>
          {STEPS.map((step, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            const level: Tone = active ? 'watch' : 'ok';
            return (
              <div key={step.key} className="tk-stream__item" data-level={active ? 'watch' : undefined}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    {done ? (
                      <Check size={15} style={{ color: 'var(--tk-ok)' }} />
                    ) : active ? (
                      <Loader2 size={15} className="animate-spin" style={{ color: 'var(--tk-live)' }} />
                    ) : (
                      <Circle size={13} style={{ color: 'var(--tk-line-3)' }} />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-[13px] font-semibold"
                        style={{ color: done || active ? 'var(--tk-text-1)' : 'var(--tk-text-3)' }}
                      >
                        {step.label}
                      </span>
                      {active && <Chip tone={level}>in progress</Chip>}
                    </div>
                    <p
                      className="text-[11.5px] mt-0.5 leading-snug"
                      style={{ color: done || active ? 'var(--tk-text-2)' : 'var(--tk-text-4)' }}
                    >
                      {step.desc}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Signed receipt on completion */}
      {order.status === 'completed' && (
        <a
          href={`/verify?order=${order.order_id}`}
          className="tk-action mt-4"
          style={{ borderStyle: 'solid', borderColor: 'var(--tk-live)', color: 'var(--tk-live)' }}
        >
          <ShieldCheck size={15} /> View signed receipt · ed25519 + ml-dsa →
        </a>
      )}

      {/* Event log */}
      {order.timeline && order.timeline.length > 0 && (
        <div className="border-t border-surface-border pt-4 mt-4">
          <p className="tk-label mb-3">Event log</p>
          <div className="space-y-3">
            {order.timeline.map((event, index) => (
              <div key={index} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5" style={{ background: 'var(--tk-live)' }} />
                  {index < order.timeline.length - 1 && <div className="w-px flex-1" style={{ background: 'var(--tk-line-2)' }} />}
                </div>
                <div className="flex-1 pb-1">
                  <p className="text-[13px] text-ink-1">{event.event}</p>
                  <p className="text-[11px] font-mono text-ink-4">{formatDate(event.timestamp)}</p>
                  {event.details && <p className="text-[11.5px] text-ink-3 mt-0.5">{event.details}</p>}
                  {event.tx_hash && (
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-[11px] font-mono text-ink-2">{truncateHash(event.tx_hash)}</code>
                      <button
                        onClick={() => handleCopy(event.tx_hash!, `tx-${index}`)}
                        aria-label="Copy transaction hash"
                        className="p-1 rounded text-ink-4 hover:text-ink-2"
                      >
                        {copiedField === `tx-${index}` ? <Check size={10} style={{ color: 'var(--tk-ok)' }} /> : <Copy size={10} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settlement transactions */}
      {(order.source_tx || order.dest_tx) && (
        <div className="border-t border-surface-border pt-4 mt-4 space-y-2">
          {order.source_tx && <TxLink label={`${srcChain?.symbol} tx`} hash={order.source_tx} chain={order.source_chain} />}
          {order.dest_tx && <TxLink label={`${dstChain?.symbol} tx`} hash={order.dest_tx} chain={order.dest_chain} />}
        </div>
      )}
    </DecisionCard>
  );
}

function TxLink({ label, hash, chain }: { label: string; hash: string; chain: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="tk-label">{label}</span>
      <a
        href={getExplorerUrl(chain, hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-live-500 hover:text-live-400 font-mono transition-colors"
      >
        {truncateHash(hash)}
        <ExternalLink size={10} />
      </a>
    </div>
  );
}

export default OrderStatusComponent;
