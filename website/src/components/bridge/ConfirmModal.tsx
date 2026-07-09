'use client';

import { useState, useEffect } from 'react';
import { ArrowDown, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { CHAINS } from '@/lib/chains';
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
  const [verified, setVerified] = useState(false);

  // Forcing function: every time the modal opens, the operator must re-affirm.
  useEffect(() => {
    if (isOpen) setVerified(false);
  }, [isOpen]);

  const dp = dstChain?.type === 'stablecoin' ? 2 : 6;
  const destShown = (parseFloat(destAmount) || 0).toFixed(dp);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm swap" size="md">
      {/* The exact consequence: send X → receive Y */}
      <div className="space-y-2.5">
        <div className="rounded-[11px] bg-surface-elevated border border-surface-border p-4">
          <div className="tk-label">You send</div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="tk-num text-2xl font-bold text-ink-0">{sourceAmount || '0'}</span>
            <div className="flex items-center gap-2">
              {srcChain && <ChainIcon chain={srcChain} size={22} />}
              <span className="text-sm font-semibold text-ink-1">{srcChain?.symbol}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="w-8 h-8 rounded-full bg-surface-card border border-surface-border flex items-center justify-center">
            <ArrowDown size={15} className="text-live-500" />
          </div>
        </div>

        <div className="rounded-[11px] bg-surface-elevated border border-surface-border p-4">
          <div className="tk-label">You receive · minimum</div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="tk-num text-2xl font-bold" style={{ color: 'var(--tk-live)' }}>{destShown}</span>
            <div className="flex items-center gap-2">
              {dstChain && <ChainIcon chain={dstChain} size={22} />}
              <span className="text-sm font-semibold text-ink-1">{dstChain?.symbol}</span>
            </div>
          </div>
        </div>
      </div>

      {/* The exact destination — shown in full so it can be verified */}
      <div className="mt-3 rounded-[11px] bg-surface-base border border-surface-border p-4">
        <div className="tk-label">Destination address · {dstChain?.symbol}</div>
        <code className="block mt-2 text-[12px] font-mono text-ink-0 break-all leading-relaxed">
          {destAddress}
        </code>
      </div>

      {/* Derivation */}
      <div className="tk-prov" style={{ marginTop: 12 }}>
        <div className="tk-prov__row"><span className="tk-prov__k">exchange rate</span><span className="tk-prov__v">1 {srcChain?.symbol} = {(Number(rate) || 0).toFixed(8)} {dstChain?.symbol}</span></div>
        <div className="tk-prov__row"><span className="tk-prov__k">bridge fee</span><span className="tk-prov__v">{feePercent}%</span></div>
        <div className="tk-prov__row"><span className="tk-prov__k">network fee</span><span className="tk-prov__v">{(Number(networkFee) || 0).toFixed(6)} {dstChain?.symbol}</span></div>
        <div className="tk-prov__row"><span className="tk-prov__k">est. settlement</span><span className="tk-prov__v">~{estimatedTime} min</span></div>
        <div className="tk-prov__row"><span className="tk-prov__k">quote lock</span><span className="tk-prov__v" style={{ color: 'var(--tk-live)' }}>30 min from creation</span></div>
      </div>

      {/* Fail-loud: irreversibility */}
      <div
        className="mt-3 flex items-start gap-2.5 p-3 rounded-[11px]"
        style={{ background: 'var(--tk-warning-bg)', border: '1px solid var(--tk-warning-line)' }}
      >
        <AlertTriangle size={16} style={{ color: 'var(--tk-warning)' }} className="shrink-0 mt-0.5" />
        <div className="text-[12px]" style={{ color: 'var(--tk-warning)' }}>
          <p className="font-bold">Sending is irreversible.</p>
          <p className="opacity-80">Funds sent to a wrong address cannot be recovered. Verify every character above.</p>
        </div>
      </div>

      {/* The forcing function — an explicit re-affirmation */}
      <label className="mt-3 flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ accentColor: 'var(--tk-live)' }}
        />
        <span className="text-[12.5px] text-ink-1">
          I have verified the destination address and the amounts. I understand this cannot be reversed.
        </span>
      </label>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] font-mono text-ink-4">
        <ShieldCheck size={12} className="text-live-500" />
        non-custodial · MPC 2-of-3 · ed25519 + ml-dsa receipt issued on completion
      </p>

      {/* Actions */}
      <div className="mt-5 flex gap-3">
        <button
          onClick={onClose}
          disabled={isLoading}
          className="tk-btn flex-1 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={!verified || isLoading}
          className="tk-btn tk-btn--live flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Creating order…
            </>
          ) : (
            <>Create order · lock quote</>
          )}
        </button>
      </div>
    </Modal>
  );
}

export default ConfirmModal;
