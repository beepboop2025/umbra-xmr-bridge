'use client';

import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldX,
  Search,
  FileJson,
  KeyRound,
  Download,
  Check,
  X,
  AlertTriangle,
  ArrowRight,
  Atom,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn, formatDate, truncateHash } from '@/lib/utils';
import apiClient from '@/lib/api-client';
import {
  verifyReceiptChain,
  getStoredPinnedKey,
  storePinnedKey,
  type ReceiptEnvelope,
  type ReceiptChainVerdict,
} from '@/lib/proof';

const OFFLINE_VERIFIER_URL =
  'https://github.com/beepboop2025/umbra-xmr-bridge/blob/main/verifier/umbra-verify.html';

type InputMode = 'order' | 'json';

function CheckMark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-baseline gap-2 text-sm">
      {ok ? (
        <Check size={14} className="shrink-0 translate-y-0.5 text-green-400" />
      ) : (
        <X size={14} className="shrink-0 translate-y-0.5 text-red-400" />
      )}
      <span className={ok ? 'text-gray-300' : 'text-red-400'}>{label}</span>
    </li>
  );
}

function PqBadge() {
  return (
    <span
      title="This receipt also carries an ML-DSA-65 (FIPS 204) post-quantum signature. It is archival: verify it server-side or with offline tools — browsers cannot verify ML-DSA yet."
      className="cursor-help"
    >
      <Badge variant="info" size="sm">
        <Atom size={12} />
        Post-quantum protected
      </Badge>
    </span>
  );
}

function ReceiptTimeline({
  receipts,
  verdict,
}: {
  receipts: ReceiptEnvelope[];
  verdict: ReceiptChainVerdict;
}) {
  return (
    <div className="space-y-4">
      {receipts.map((receipt, i) => {
        const result = verdict.results[i];
        const payload = receipt.payload;
        if (!result || !payload) return null;
        const receiptOk =
          result.canonicalMatches &&
          result.hashMatches &&
          result.signatureValid &&
          result.chainLinks &&
          result.pinMatches !== false;

        return (
          <Card key={`${payload.order_id}-${payload.sequence}`} className="relative">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold',
                    receiptOk
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                  )}
                >
                  {payload.sequence}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white capitalize">
                    {String(payload.event).replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-gray-500">{formatDate(payload.timestamp)}</p>
                </div>
              </div>
              {result.hasPqSignature && <PqBadge />}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
              <span className="font-mono text-white">
                {payload.from_amount} {payload.from_currency}
              </span>
              <ArrowRight size={14} className="text-gray-500" />
              <span className="font-mono text-white">
                {payload.to_amount} {payload.to_currency}
              </span>
              <span className="text-xs text-gray-500">
                rate {payload.rate} · fee {payload.fee} ({payload.fee_percent}%)
              </span>
            </div>

            <div className="space-y-1 text-xs font-mono text-gray-500 break-all mb-3">
              {payload.deposit_tx_hash && (
                <p>
                  <span className="text-gray-400">deposit tx</span> {payload.deposit_tx_hash}
                </p>
              )}
              {payload.withdrawal_tx_hash && (
                <p>
                  <span className="text-gray-400">withdrawal tx</span>{' '}
                  {payload.withdrawal_tx_hash}
                </p>
              )}
              <p>
                <span className="text-gray-400">payload hash</span>{' '}
                {truncateHash(result.payloadHash, 16)}
              </p>
            </div>

            <ul className="space-y-1 pt-3 border-t border-surface-border">
              <CheckMark
                ok={result.canonicalMatches}
                label="Server canonical form matches local re-canonicalization"
              />
              <CheckMark
                ok={result.hashMatches}
                label="SHA-256 of canonical payload matches payload_hash"
              />
              <CheckMark
                ok={result.signatureValid}
                label="Ed25519 signature valid over canonical payload"
              />
              <CheckMark
                ok={result.chainLinks}
                label={
                  i === 0
                    ? payload.sequence === 0
                      ? 'First receipt anchors to the genesis hash'
                      : `Starts at sequence ${payload.sequence} (partial history — earlier receipts not provided)`
                    : 'prev_receipt_hash links to the previous receipt'
                }
              />
              {result.pinMatches !== null && (
                <CheckMark
                  ok={result.pinMatches}
                  label={
                    result.pinMatches
                      ? 'Signed by your pinned key'
                      : 'Signed by a DIFFERENT key than your pin'
                  }
                />
              )}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

export default function VerifyPage() {
  const [mode, setMode] = useState<InputMode>('order');
  const [orderId, setOrderId] = useState('');
  const [rawJson, setRawJson] = useState('');
  const [pinnedKey, setPinnedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptEnvelope[] | null>(null);
  const [verdict, setVerdict] = useState<ReceiptChainVerdict | null>(null);

  useEffect(() => {
    const stored = getStoredPinnedKey();
    if (stored) setPinnedKey(stored);
  }, []);

  const handlePinnedKeyChange = (value: string) => {
    setPinnedKey(value);
    storePinnedKey(value);
  };

  const runVerification = async () => {
    setError(null);
    setReceipts(null);
    setVerdict(null);
    setLoading(true);

    try {
      let list: ReceiptEnvelope[];

      if (mode === 'order') {
        const id = orderId.trim();
        if (!id) {
          throw new Error('Enter an order ID first');
        }
        try {
          const bundle = await apiClient.getProofReceipts(id);
          list = bundle.receipts || [];
        } catch (e) {
          const err = e as { message?: string; status?: number };
          if (err.status === 404) {
            throw new Error(`No receipts found for order "${id}" — check the order ID`);
          }
          throw new Error(
            `Could not reach the bridge API: ${err.message || 'network error'}`
          );
        }
        if (!list.length) {
          throw new Error(`Order "${id}" has no receipts yet`);
        }
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawJson);
        } catch (e) {
          throw new Error(`Input is not valid JSON: ${(e as Error).message}`);
        }
        const data = parsed as
          | ReceiptEnvelope
          | ReceiptEnvelope[]
          | { receipts?: ReceiptEnvelope[] };
        list = Array.isArray(data)
          ? data
          : ((data as { receipts?: ReceiptEnvelope[] }).receipts ?? [data as ReceiptEnvelope]);
        if (!list.length) {
          throw new Error('No receipts found in the pasted JSON');
        }
      }

      const result = await verifyReceiptChain(list, pinnedKey || null);
      if (result.error) {
        throw new Error(result.error);
      }
      setReceipts(list);
      setVerdict(result);
    } catch (e) {
      setError((e as Error).message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Verify a Receipt</h1>
        <p className="text-gray-400 mt-2">
          Check the bridge&apos;s signed swap receipts against its own promises. All
          cryptography runs locally in your browser — nothing you paste here is sent anywhere.
        </p>
      </div>

      {/* Offline verifier note */}
      <Card className="mb-6 border-xmr-500/20 bg-xmr-500/5">
        <div className="flex items-start gap-3">
          <Download size={18} className="shrink-0 mt-0.5 text-xmr-400" />
          <div className="text-sm">
            <p className="text-gray-300">
              Don&apos;t want to trust this website either?{' '}
              <a
                href={OFFLINE_VERIFIER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xmr-400 hover:text-xmr-300 font-medium underline underline-offset-2"
              >
                Download umbra-verify.html
              </a>{' '}
              — a single self-contained file you can open from your own disk. It makes zero
              network requests and verifies the same receipts, checkpoints, and Merkle
              inclusion proofs.
            </p>
          </div>
        </div>
      </Card>

      {/* Input mode toggle */}
      <div className="flex gap-2 mb-4">
        <Button
          variant={mode === 'order' ? 'primary' : 'secondary'}
          size="sm"
          icon={<Search size={14} />}
          onClick={() => setMode('order')}
        >
          Order ID
        </Button>
        <Button
          variant={mode === 'json' ? 'primary' : 'secondary'}
          size="sm"
          icon={<FileJson size={14} />}
          onClick={() => setMode('json')}
        >
          Raw receipt JSON
        </Button>
      </div>

      <Card className="mb-6">
        {mode === 'order' ? (
          <Input
            label="Order ID"
            placeholder="Paste your order ID — receipts are fetched, then verified in your browser"
            icon={<Search size={16} />}
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runVerification()}
            hint="The API only supplies the data; every signature check happens client-side."
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="raw-receipt-json" className="text-sm font-medium text-gray-300">
              Receipt JSON
            </label>
            <textarea
              id="raw-receipt-json"
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              placeholder='Paste the full response of GET /v1/proof/receipt/<order_id>, a single receipt object, or an array of receipts'
              rows={8}
              className="w-full rounded-lg bg-surface-elevated border border-surface-border text-white placeholder:text-gray-600 font-mono text-xs p-4 transition-all duration-200 focus:border-xmr-500/50 focus:ring-1 focus:ring-xmr-500/20 focus:outline-none resize-y"
            />
            <p className="text-xs text-gray-500">
              Fully offline: pasted JSON never leaves your browser.
            </p>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-surface-border">
          <Input
            label="Pinned public key (optional but recommended)"
            placeholder="64 hex chars from /v1/proof/key — obtain it out-of-band and keep it"
            icon={<KeyRound size={16} />}
            value={pinnedKey}
            onChange={(e) => handlePinnedKeyChange(e.target.value)}
            className="font-mono text-xs"
            hint="If set, every signature must be made by exactly this key. Without a pin, verification proves internal consistency but not who signed. Stored only in your browser."
          />
        </div>

        <Button
          className="mt-4"
          icon={<ShieldCheck size={16} />}
          onClick={runVerification}
          loading={loading}
        >
          Verify receipts
        </Button>
      </Card>

      {/* Error */}
      {error && (
        <Card className="mb-6 border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </Card>
      )}

      {/* Verdict banner */}
      {verdict && receipts && (
        <>
          <Card
            className={cn(
              'mb-6',
              verdict.ok
                ? 'border-green-500/40 bg-green-500/5'
                : 'border-red-500/40 bg-red-500/5'
            )}
          >
            <div className="flex items-center gap-4">
              {verdict.ok ? (
                <ShieldCheck size={32} className="shrink-0 text-green-400" />
              ) : (
                <ShieldX size={32} className="shrink-0 text-red-400" />
              )}
              <div>
                <p
                  className={cn(
                    'text-lg font-bold',
                    verdict.ok ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {verdict.ok
                    ? `All ${receipts.length} receipt${receipts.length === 1 ? '' : 's'} verified`
                    : 'Verification failed'}
                </p>
                <p className="text-sm text-gray-400">
                  {verdict.ok
                    ? 'This history is exactly what the bridge signed.'
                    : 'Do not trust this receipt data.'}
                </p>
              </div>
            </div>
            {!verdict.singleKey && (
              <p className="mt-3 pt-3 border-t border-red-500/20 text-sm text-red-400">
                Receipts are signed by multiple different keys — investigate.
              </p>
            )}
            {verdict.partialHistory && (
              <p className="mt-3 pt-3 border-t border-surface-border text-sm text-yellow-400">
                Partial history: the first pasted receipt is not sequence 0, so linkage to
                earlier receipts could not be checked.
              </p>
            )}
          </Card>

          <ReceiptTimeline receipts={receipts} verdict={verdict} />
        </>
      )}
    </div>
  );
}
