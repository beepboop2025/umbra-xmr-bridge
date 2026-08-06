'use client';

import { useState, useCallback, useEffect } from 'react';
import { ArrowUpDown, AlertCircle, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useBridgeStore } from '@/stores/bridge-store';
import { useRate } from '@/hooks/useRate';
import { useCreateOrder } from '@/hooks/useOrders';
import { validateBridgeRequest } from '@/lib/validators';
import { CHAINS } from '@/lib/chains';
import { DecisionCard, Hero, Chip, ConfidenceMeter } from '@/components/tikto/primitives';
import { NumberRoll } from '@/components/tikto/motion';
import { ChainSelector } from './ChainSelector';
import { AmountInput } from './AmountInput';
import { AddressInput } from './AddressInput';
import { FeeBreakdown } from './FeeBreakdown';
import { RateDisplay } from './RateDisplay';
import { ConfirmModal } from './ConfirmModal';

export function BridgeForm() {
  const bridge = useBridgeStore();
  const { rate, feePercent, networkFee, estimatedTime, maxAmount } = useRate();
  const { createOrder } = useCreateOrder();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Quote-freshness: a live streaming quote breathing within the "fresh" band,
  // resetting whenever the rate updates. (Both clocks start at 0 to stay
  // hydration-stable, then advance on the client.)
  const [quoteTs, setQuoteTs] = useState(0);
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    setNowTs(Date.now());
    setQuoteTs((t) => (t === 0 ? Date.now() : t));
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (rate > 0) setQuoteTs(Date.now());
  }, [rate]);
  const ageSec = quoteTs && nowTs ? Math.min(30, Math.max(0, Math.round((nowTs - quoteTs) / 1000))) : 0;
  const freshness = 0.8 + 0.2 * (1 - ageSec / 30);

  const handleFlip = useCallback(() => {
    bridge.flipDirection();
  }, [bridge]);

  const handleSubmit = useCallback(() => {
    setFormError(null);
    const validation = validateBridgeRequest({
      sourceChain: bridge.sourceChain,
      destChain: bridge.destChain,
      amount: bridge.sourceAmount,
      address: bridge.destAddress,
    });

    if (!validation.valid) {
      setFormError(validation.error || 'Invalid input');
      return;
    }

    setShowConfirm(true);
  }, [bridge]);

  const handleConfirm = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await createOrder({
        source_chain: bridge.sourceChain,
        dest_chain: bridge.destChain,
        amount: parseFloat(bridge.sourceAmount),
        dest_address: bridge.destAddress,
        refund_address: bridge.refundAddress || undefined,
      });
      // Only close modal and reset on success
      setShowConfirm(false);
      bridge.reset();
    } catch {
      // Error toast shown by useCreateOrder — keep modal open so user can retry
    } finally {
      setIsSubmitting(false);
    }
  }, [bridge, createOrder]);

  const isXmrSource = bridge.sourceChain === 'XMR';
  const srcSym = CHAINS[bridge.sourceChain]?.symbol ?? bridge.sourceChain;
  const dst = CHAINS[bridge.destChain];
  const dstSym = dst?.symbol ?? bridge.destChain;

  const destNum = parseFloat(bridge.destAmount) || 0;
  const hasQuote = parseFloat(bridge.sourceAmount || '0') > 0 && rate > 0 && destNum > 0;
  const dp = dst?.type === 'stablecoin' ? 2 : 6;

  return (
    <>
      <DecisionCard
        tone="ok"
        className="max-w-lg w-full"
        title={<span className="tk-num">{srcSym} → {dstSym} · swap</span>}
        chip={<Chip tone="ok">● live</Chip>}
      >
        <p className="text-[11px] font-mono text-ink-4 -mt-2 mb-4">
          as of now · threshold custody · quote locks 30 min on order
        </p>

        {/* YOU SEND */}
        <div className="space-y-3">
          <div className="tk-label">You send</div>
          <div className="relative">
            <ChainSelector
              selectedChain={bridge.sourceChain}
              onSelect={bridge.setSourceChain}
              excludeChain={bridge.destChain}
              xmrOnly={isXmrSource}
            />
          </div>
          <AmountInput
            chain={bridge.sourceChain}
            value={bridge.sourceAmount}
            onChange={bridge.setSourceAmount}
            maxAmount={maxAmount}
          />
        </div>

        {/* Flip */}
        <div className="flex justify-center my-3 relative z-10">
          <motion.button
            whileTap={{ scale: 0.9, rotate: 180 }}
            onClick={handleFlip}
            aria-label="Flip direction"
            className="w-10 h-10 rounded-[11px] bg-surface-elevated border border-surface-border flex items-center justify-center text-ink-3 hover:text-live-500 hover:border-live-500/40 transition-colors"
          >
            <ArrowUpDown size={18} />
          </motion.button>
        </div>

        {/* YOU RECEIVE — the hero number */}
        <div className="space-y-3">
          <div className="tk-label">You receive</div>
          <div className="relative">
            <ChainSelector
              selectedChain={bridge.destChain}
              onSelect={bridge.setDestChain}
              excludeChain={bridge.sourceChain}
              xmrOnly={!isXmrSource}
            />
          </div>

          <div className="rounded-[14px] bg-surface-base border border-surface-border px-4 py-4">
            <Hero
              value={hasQuote ? <NumberRoll value={destNum} format={(v) => v.toFixed(dp)} /> : '——'}
              unit={dstSym}
            />
            <div className="mt-4 pt-3 border-t border-surface-border">
              <RateDisplay source={bridge.sourceChain} dest={bridge.destChain} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ConfidenceMeter value={freshness} />
                <span className="tk-label" style={{ color: 'var(--tk-text-3)' }}>quote freshness</span>
              </div>
              <span className="text-[11px] font-mono text-ink-4">updated {ageSec}s ago · locks 30m on order</span>
            </div>
          </div>
        </div>

        {/* Destination address */}
        <div className="mt-4">
          <AddressInput
            label={`${dstSym} destination address`}
            chain={bridge.destChain}
            value={bridge.destAddress}
            onChange={bridge.setDestAddress}
          />
        </div>

        {/* Fee breakdown — provenance on pull */}
        {bridge.sourceAmount && parseFloat(bridge.sourceAmount) > 0 && rate > 0 && (
          <div className="mt-4">
            <FeeBreakdown
              sourceChain={bridge.sourceChain}
              destChain={bridge.destChain}
              sourceAmount={parseFloat(bridge.sourceAmount)}
              destAmount={parseFloat(bridge.destAmount) || 0}
              rate={rate}
              feePercent={feePercent}
              networkFee={networkFee}
              estimatedTime={estimatedTime}
            />
          </div>
        )}

        {/* Fail-loud error */}
        {formError && (
          <div
            className="mt-4 flex items-center gap-2 p-3 rounded-[11px]"
            style={{ background: 'var(--tk-critical-bg)', border: '1px solid var(--tk-critical-line)' }}
          >
            <AlertCircle size={14} style={{ color: 'var(--tk-critical)' }} className="shrink-0" />
            <p className="text-[12px] font-medium" style={{ color: 'var(--tk-critical)' }}>{formError}</p>
          </div>
        )}

        {/* The act — cyan, opens the forcing-function confirm */}
        <button
          onClick={handleSubmit}
          disabled={!bridge.sourceAmount || !bridge.destAddress || !rate}
          className="tk-btn tk-btn--live w-full justify-center mt-5 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ padding: '13px 16px', fontSize: 13.5 }}
        >
          Review swap · {srcSym} → {dstSym} <ArrowRight size={15} />
        </button>

        <p className="text-center text-[11px] font-mono text-ink-4 mt-3">
          no account fields · signed receipt on recorded completion
        </p>
      </DecisionCard>

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirm}
        isLoading={isSubmitting}
        sourceChain={bridge.sourceChain}
        destChain={bridge.destChain}
        sourceAmount={bridge.sourceAmount}
        destAmount={bridge.destAmount}
        destAddress={bridge.destAddress}
        rate={rate}
        feePercent={feePercent}
        networkFee={networkFee}
        estimatedTime={estimatedTime}
      />
    </>
  );
}

export default BridgeForm;
