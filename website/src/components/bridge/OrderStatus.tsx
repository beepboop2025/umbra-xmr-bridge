'use client';

import { Check, Clock, Loader2, AlertTriangle, Copy, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { OrderDetail, OrderStatus as OrderStatusType } from '@/lib/api-client';
import { truncateHash, formatDate, copyToClipboard, getExplorerUrl } from '@/lib/utils';
import { CHAINS } from '@/lib/chains';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface OrderStatusProps {
  order: OrderDetail;
  className?: string;
}

const stepOrder: OrderStatusType[] = [
  'awaiting_deposit',
  'confirming',
  'exchanging',
  'sending',
  'completed',
];

function getStepIndex(status: OrderStatusType): number {
  const idx = stepOrder.indexOf(status);
  if (status === 'expired' || status === 'failed' || status === 'refunded') return -1;
  return idx >= 0 ? idx : 0;
}

export function OrderStatusComponent({ order, className }: OrderStatusProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const currentStep = getStepIndex(order.status);
  const isFailed = ['expired', 'failed', 'refunded'].includes(order.status);

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <Card className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-gray-400">Order</p>
          <p className="text-lg font-bold font-mono text-white">{order.order_id}</p>
        </div>
        <StatusBadge status={order.status} size="md" />
      </div>

      {/* Progress Steps */}
      {!isFailed && (
        <div className="mb-6">
          <div className="flex items-center justify-between relative">
            {/* Progress line */}
            <div className="absolute top-4 left-4 right-4 h-0.5 bg-surface-border">
              <div
                className="h-full bg-xmr-500 transition-all duration-500"
                style={{ width: `${(currentStep / (stepOrder.length - 1)) * 100}%` }}
              />
            </div>

            {stepOrder.map((step, index) => {
              const isCompleted = index <= currentStep;
              const isCurrent = index === currentStep;

              return (
                <div key={step} className="flex flex-col items-center relative z-10">
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors',
                      isCompleted
                        ? 'bg-xmr-500 border-xmr-500'
                        : 'bg-surface-card border-surface-border'
                    )}
                  >
                    {isCompleted && index < currentStep ? (
                      <Check size={14} className="text-white" />
                    ) : isCurrent ? (
                      <Loader2 size={14} className="text-white animate-spin" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-gray-600" />
                    )}
                  </div>
                  <p
                    className={cn(
                      'text-[10px] mt-2 whitespace-nowrap capitalize',
                      isCompleted ? 'text-xmr-400' : 'text-gray-600'
                    )}
                  >
                    {step.replace('_', ' ')}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Failed State */}
      {isFailed && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/5 border border-red-500/20 flex gap-3">
          <AlertTriangle size={20} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400">
              Order {order.status === 'expired' ? 'Expired' : order.status === 'refunded' ? 'Refunded' : 'Failed'}
            </p>
            <p className="text-xs text-red-400/70 mt-1">
              {order.status === 'expired'
                ? 'This order has expired. No deposit was received within the time limit.'
                : order.status === 'refunded'
                ? 'Your deposit has been refunded to your refund address.'
                : 'An error occurred while processing this order. Please contact support.'}
            </p>
          </div>
        </div>
      )}

      {/* Deposit Address */}
      {order.status === 'awaiting_deposit' && (
        <div className="mb-6 p-4 rounded-xl bg-xmr-500/5 border border-xmr-500/20">
          <p className="text-xs text-gray-400 mb-2">Send exactly {order.amount} {CHAINS[order.source_chain]?.symbol} to:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono text-xmr-400 break-all">
              {order.deposit_address}
            </code>
            <button
              onClick={() => handleCopy(order.deposit_address, 'deposit')}
              className="shrink-0 p-2 rounded-lg hover:bg-surface-elevated transition-colors"
            >
              {copiedField === 'deposit' ? (
                <Check size={14} className="text-green-400" />
              ) : (
                <Copy size={14} className="text-gray-500" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {order.timeline && order.timeline.length > 0 && (
        <div className="border-t border-surface-border pt-4">
          <p className="text-sm font-medium text-gray-300 mb-3">Timeline</p>
          <div className="space-y-3">
            {order.timeline.map((event, index) => (
              <div key={index} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-xmr-500 mt-1.5" />
                  {index < order.timeline.length - 1 && (
                    <div className="w-px h-full bg-surface-border" />
                  )}
                </div>
                <div className="flex-1 pb-3">
                  <p className="text-sm text-white">{event.event}</p>
                  <p className="text-xs text-gray-500">{formatDate(event.timestamp)}</p>
                  {event.tx_hash && (
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs font-mono text-gray-400">
                        {truncateHash(event.tx_hash)}
                      </code>
                      <button
                        onClick={() => handleCopy(event.tx_hash!, `tx-${index}`)}
                        className="p-1 rounded text-gray-600 hover:text-gray-400"
                      >
                        {copiedField === `tx-${index}` ? (
                          <Check size={10} className="text-green-400" />
                        ) : (
                          <Copy size={10} />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TX Hashes */}
      {(order.source_tx || order.dest_tx) && (
        <div className="border-t border-surface-border pt-4 mt-4 space-y-2">
          {order.source_tx && (
            <TxLink
              label={`${CHAINS[order.source_chain]?.symbol} TX`}
              hash={order.source_tx}
              chain={order.source_chain}
            />
          )}
          {order.dest_tx && (
            <TxLink
              label={`${CHAINS[order.dest_chain]?.symbol} TX`}
              hash={order.dest_tx}
              chain={order.dest_chain}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function TxLink({ label, hash, chain }: { label: string; hash: string; chain: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <a
        href={getExplorerUrl(chain, hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-xmr-400 hover:text-xmr-300 font-mono transition-colors"
      >
        {truncateHash(hash)}
        <ExternalLink size={10} />
      </a>
    </div>
  );
}

export default OrderStatusComponent;
