'use client';

import { useState, useCallback } from 'react';
import { ArrowUpDown, AlertCircle, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import { useBridgeStore } from '@/stores/bridge-store';
import { useRate } from '@/hooks/useRate';
import { useCreateOrder } from '@/hooks/useOrders';
import { validateBridgeRequest } from '@/lib/validators';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChainSelector } from './ChainSelector';
import { AmountInput } from './AmountInput';
import { AddressInput } from './AddressInput';
import { FeeBreakdown } from './FeeBreakdown';
import { RateDisplay } from './RateDisplay';
import { ConfirmModal } from './ConfirmModal';

export function BridgeForm() {
  const bridge = useBridgeStore();
  const { rate, feePercent, networkFee, estimatedTime, minAmount, maxAmount } = useRate();
  const { createOrder } = useCreateOrder();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      setShowConfirm(false);
      bridge.reset();
    } catch {
      // Error handled by useCreateOrder
    } finally {
      setIsSubmitting(false);
    }
  }, [bridge, createOrder]);

  const isXmrSource = bridge.sourceChain === 'XMR';

  return (
    <>
      <Card className="max-w-lg w-full" padding="lg" gradient>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Bridge</h2>
            <p className="text-sm text-gray-400 mt-0.5">Swap XMR privately</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20">
            <Shield size={12} className="text-green-400" />
            <span className="text-xs text-green-400 font-medium">No KYC</span>
          </div>
        </div>

        {/* Source Chain */}
        <div className="space-y-4">
          <div className="relative">
            <ChainSelector
              selectedChain={bridge.sourceChain}
              onSelect={bridge.setSourceChain}
              excludeChain={bridge.destChain}
              xmrOnly={isXmrSource}
              label="From"
            />
          </div>

          <AmountInput
            label="You Send"
            chain={bridge.sourceChain}
            value={bridge.sourceAmount}
            onChange={bridge.setSourceAmount}
            maxAmount={maxAmount}
          />

          {/* Flip Button */}
          <div className="flex justify-center -my-1 relative z-10">
            <motion.button
              whileTap={{ scale: 0.9, rotate: 180 }}
              onClick={handleFlip}
              className="w-10 h-10 rounded-xl bg-surface-elevated border border-surface-border flex items-center justify-center text-gray-400 hover:text-xmr-400 hover:border-xmr-500/30 transition-colors"
            >
              <ArrowUpDown size={18} />
            </motion.button>
          </div>

          {/* Dest Chain */}
          <div className="relative">
            <ChainSelector
              selectedChain={bridge.destChain}
              onSelect={bridge.setDestChain}
              excludeChain={bridge.sourceChain}
              xmrOnly={!isXmrSource}
              label="To"
            />
          </div>

          <AmountInput
            label="You Receive"
            chain={bridge.destChain}
            value={bridge.destAmount}
            readOnly
          />

          {/* Rate Display */}
          <RateDisplay source={bridge.sourceChain} dest={bridge.destChain} />

          {/* Destination Address */}
          <AddressInput
            label={`${bridge.destChain} Destination Address`}
            chain={bridge.destChain}
            value={bridge.destAddress}
            onChange={bridge.setDestAddress}
          />

          {/* Fee Breakdown */}
          {bridge.sourceAmount && parseFloat(bridge.sourceAmount) > 0 && rate > 0 && (
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
          )}

          {/* Error */}
          {formError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={14} className="text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{formError}</p>
            </div>
          )}

          {/* Submit */}
          <Button
            size="xl"
            fullWidth
            onClick={handleSubmit}
            disabled={!bridge.sourceAmount || !bridge.destAddress || !rate}
          >
            Bridge {bridge.sourceChain} to {bridge.destChain}
          </Button>

          <p className="text-center text-xs text-gray-600">
            Non-custodial swap. No registration required.
          </p>
        </div>
      </Card>

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
