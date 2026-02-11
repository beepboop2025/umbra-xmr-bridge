'use client';

import { ArrowDown, AlertTriangle, Shield, Clock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CHAINS } from '@/lib/chains';
import { truncateAddress, formatNumber } from '@/lib/utils';
import { ChainIcon } from './ChainSelector';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  sourceChain: string;
  destChain: string;
  sourceAmount: string;
  destAmount: string;
  destAddress: string;
  rate: number;
  feePercent: number;
  networkFee: number;
  estimatedTime: number;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  sourceChain,
  destChain,
  sourceAmount,
  destAmount,
  destAddress,
  rate,
  feePercent,
  networkFee,
  estimatedTime,
}: ConfirmModalProps) {
  const srcChain = CHAINS[sourceChain];
  const dstChain = CHAINS[destChain];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm Bridge" size="md">
      {/* From/To */}
      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border">
          <p className="text-xs text-gray-500 mb-2">You Send</p>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold text-white">{sourceAmount}</span>
            <div className="flex items-center gap-2">
              {srcChain && <ChainIcon chain={srcChain} size={24} />}
              <span className="text-sm font-medium text-gray-300">{srcChain?.symbol}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center -my-1">
          <div className="w-8 h-8 rounded-full bg-surface-card border border-surface-border flex items-center justify-center">
            <ArrowDown size={16} className="text-xmr-400" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border">
          <p className="text-xs text-gray-500 mb-2">You Receive</p>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold text-green-400">{destAmount}</span>
            <div className="flex items-center gap-2">
              {dstChain && <ChainIcon chain={dstChain} size={24} />}
              <span className="text-sm font-medium text-gray-300">{dstChain?.symbol}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="mt-4 p-4 rounded-xl bg-surface-base border border-surface-border space-y-2.5">
        <DetailRow label="Destination Address" value={truncateAddress(destAddress, 10, 8)} mono />
        <DetailRow label="Exchange Rate" value={`1 ${srcChain?.symbol} = ${(Number(rate) || 0).toFixed(8)} ${dstChain?.symbol}`} />
        <DetailRow label="Bridge Fee" value={`${feePercent}%`} />
        <DetailRow label="Network Fee" value={`${(Number(networkFee) || 0).toFixed(6)} ${dstChain?.symbol}`} />
        <DetailRow
          label="Estimated Time"
          value={`~${estimatedTime} min`}
          icon={<Clock size={12} className="text-gray-500" />}
        />
      </div>

      {/* Warnings */}
      <div className="mt-4 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 flex gap-3">
        <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
        <div className="text-xs text-yellow-400/80">
          <p className="font-medium text-yellow-400 mb-1">Please verify carefully</p>
          <p>Double-check the destination address. Transactions cannot be reversed once confirmed.</p>
        </div>
      </div>

      {/* Privacy */}
      <div className="mt-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20 flex gap-3">
        <Shield size={16} className="text-green-400 shrink-0 mt-0.5" />
        <p className="text-xs text-green-400/80">
          This bridge is non-custodial and requires no KYC. Your privacy is protected by Monero&apos;s ring signatures.
        </p>
      </div>

      {/* Actions */}
      <div className="mt-5 flex gap-3">
        <Button variant="secondary" fullWidth onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button fullWidth onClick={onConfirm} loading={isLoading}>
          Confirm Bridge
        </Button>
      </div>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500 flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className={`text-gray-300 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

export default ConfirmModal;
