'use client';

import { ArrowRight, Copy, Check, ExternalLink, Clock, Shield } from 'lucide-react';
import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { CHAINS } from '@/lib/chains';
import { ChainIcon } from '@/components/bridge/ChainSelector';
import { formatDate, truncateAddress, truncateHash, copyToClipboard, getExplorerUrl } from '@/lib/utils';
import type { OrderDetail } from '@/lib/api-client';

interface TxDetailProps {
  order: OrderDetail;
}

export function TxDetail({ order }: TxDetailProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const srcChain = CHAINS[order.source_chain];
  const dstChain = CHAINS[order.dest_chain];

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-sm text-gray-400">Transaction</p>
            <p className="text-xl font-bold font-mono text-white">{order.order_id}</p>
          </div>
          <StatusBadge status={order.status} size="md" />
        </div>

        {/* From -> To */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-surface-elevated">
          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              {srcChain && <ChainIcon chain={srcChain} size={28} />}
              <span className="text-sm font-medium text-gray-300">{srcChain?.name}</span>
            </div>
            <p className="text-xl font-bold text-white font-mono">
              {(Number(order.amount) || 0).toFixed(6)} {srcChain?.symbol}
            </p>
          </div>

          <ArrowRight size={24} className="text-xmr-400 shrink-0" />

          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              {dstChain && <ChainIcon chain={dstChain} size={28} />}
              <span className="text-sm font-medium text-gray-300">{dstChain?.name}</span>
            </div>
            <p className="text-xl font-bold text-green-400 font-mono">
              {(Number(order.receive_amount) || 0).toFixed(6)} {dstChain?.symbol}
            </p>
          </div>
        </div>
      </Card>

      {/* Details Card */}
      <Card>
        <h3 className="text-lg font-semibold text-white mb-4">Details</h3>
        <div className="space-y-3">
          <DetailRow label="Order ID" value={order.order_id} copyable onCopy={handleCopy} copiedField={copiedField} />
          <DetailRow label="Created" value={formatDate(order.created_at)} />
          {order.completed_at && <DetailRow label="Completed" value={formatDate(order.completed_at)} />}
          <DetailRow label="Exchange Rate" value={`1 ${srcChain?.symbol} = ${(Number(order.rate) || 0).toFixed(8)} ${dstChain?.symbol}`} />
          <DetailRow label="Fee" value={`${order.fee_percent}% + ${(Number(order.network_fee) || 0).toFixed(6)} ${dstChain?.symbol}`} />
          <DetailRow label="Destination" value={order.dest_address} mono copyable onCopy={handleCopy} copiedField={copiedField} />
          {order.deposit_address && (
            <DetailRow label="Deposit Address" value={order.deposit_address} mono copyable onCopy={handleCopy} copiedField={copiedField} />
          )}
          {order.source_tx && (
            <DetailRow
              label={`${srcChain?.symbol} TX`}
              value={truncateHash(order.source_tx, 12)}
              href={getExplorerUrl(order.source_chain, order.source_tx)}
              mono
              copyable
              copyValue={order.source_tx}
              onCopy={handleCopy}
              copiedField={copiedField}
            />
          )}
          {order.dest_tx && (
            <DetailRow
              label={`${dstChain?.symbol} TX`}
              value={truncateHash(order.dest_tx, 12)}
              href={getExplorerUrl(order.dest_chain, order.dest_tx)}
              mono
              copyable
              copyValue={order.dest_tx}
              onCopy={handleCopy}
              copiedField={copiedField}
            />
          )}
        </div>
      </Card>

      {/* Timeline */}
      {order.timeline && order.timeline.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-white mb-4">Timeline</h3>
          <div className="space-y-4">
            {order.timeline.map((event, index) => (
              <div key={index} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-xmr-500 mt-1" />
                  {index < order.timeline.length - 1 && (
                    <div className="w-px flex-1 bg-surface-border mt-1" />
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <p className="text-sm font-medium text-white">{event.event}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    <Clock size={10} className="inline mr-1" />
                    {formatDate(event.timestamp)}
                  </p>
                  {event.tx_hash && (
                    <p className="text-xs font-mono text-gray-400 mt-1">
                      TX: {truncateHash(event.tx_hash)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Privacy Notice */}
      <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20 flex gap-3">
        <Shield size={20} className="text-green-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-green-400">Privacy Protected</p>
          <p className="text-xs text-green-400/70 mt-1">
            This transaction was processed through a non-custodial bridge with no KYC requirements.
            Monero&apos;s ring signatures ensure sender privacy.
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  copyable = false,
  copyValue,
  href,
  onCopy,
  copiedField,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  copyValue?: string;
  href?: string;
  onCopy?: (text: string, field: string) => void;
  copiedField?: string | null;
}) {
  const textToCopy = copyValue || value;
  const isCopied = copiedField === label;

  return (
    <div className="flex items-start justify-between py-2 border-b border-surface-border/50 last:border-0">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <div className="flex items-center gap-2 ml-4">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm text-xmr-400 hover:text-xmr-300 transition-colors ${mono ? 'font-mono' : ''}`}
          >
            {value}
            <ExternalLink size={10} className="inline ml-1" />
          </a>
        ) : (
          <span className={`text-sm text-gray-200 break-all text-right ${mono ? 'font-mono text-xs' : ''}`}>
            {value}
          </span>
        )}
        {copyable && onCopy && (
          <button
            onClick={() => onCopy(textToCopy, label)}
            className="shrink-0 p-1 rounded text-gray-600 hover:text-gray-400 transition-colors"
          >
            {isCopied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
        )}
      </div>
    </div>
  );
}

export default TxDetail;
