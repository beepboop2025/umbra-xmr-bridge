'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  ShieldX,
  Search,
  FileJson,
  KeyRound,
  Download,
  Check,
  X,
  Minus,
  AlertTriangle,
  ArrowRight,
  Atom,
} from 'lucide-react';
import { formatDate, truncateHash } from '@/lib/utils';
import apiClient from '@/lib/api-client';
import { Chip, DecisionCard, Panel, Provenance, TrustStrip } from '@/components/tikto/primitives';
import { Reveal } from '@/components/tikto/motion';
import {
  verifyReceiptChain,
  getStoredPinnedKey,
  storePinnedKey,
  type ReceiptEnvelope,
  type ReceiptChainVerdict,
} from '@/lib/proof';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const API_HOST = (() => {
  try {
    return new URL(API_BASE).host;
  } catch {
    return API_BASE;
  }
})();

const OFFLINE_VERIFIER_URL =
  'https://github.com/beepboop2025/umbra-xmr-bridge/blob/main/verifier/umbra-verify.html';

type InputMode = 'order' | 'json';
type RowTone = 'ok' | 'critical' | 'watch' | 'stale';

/** One glass-box verification step: icon + colour + text, never colour alone. */
function CheckRow({ ok, tone, children }: { ok?: boolean; tone?: RowTone; children: ReactNode }) {
  const t: RowTone = tone ?? (ok ? 'ok' : 'critical');
  const color = `var(--tk-${t})`;
  const Icon = t === 'ok' ? Check : t === 'critical' ? X : t === 'watch' ? Atom : Minus;
  const textColor =
    t === 'critical' ? 'var(--tk-critical)' : t === 'stale' ? 'var(--tk-text-3)' : 'var(--tk-text-2)';
  return (
    <li className="flex items-baseline gap-2 text-[13px]">
      <Icon size={14} className="shrink-0 translate-y-0.5" style={{ color }} />
      <span style={{ color: textColor }}>{children}</span>
    </li>
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
          <DecisionCard
            key={`${payload.order_id}-${payload.sequence}`}
            tone={receiptOk ? 'ok' : 'critical'}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-3">
                <div
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold tk-num"
                  style={{
                    background: receiptOk ? 'var(--tk-ok-bg)' : 'var(--tk-critical-bg)',
                    color: receiptOk ? 'var(--tk-ok)' : 'var(--tk-critical)',
                    border: `1px solid ${receiptOk ? 'var(--tk-ok-line)' : 'var(--tk-critical-line)'}`,
                  }}
                >
                  {payload.sequence}
                </div>
                <div>
                  <p className="text-[14px] font-bold text-ink-0 capitalize">
                    {String(payload.event).replace(/_/g, ' ')}
                  </p>
                  <p className="text-[11px] text-ink-3 font-mono">{formatDate(payload.timestamp)}</p>
                </div>
              </div>
              {result.hasPqSignature ? (
                <Chip tone="watch">
                  <Atom size={11} /> post-quantum
                </Chip>
              ) : (
                <Chip tone={receiptOk ? 'ok' : 'critical'}>{receiptOk ? 'verified' : 'failed'}</Chip>
              )}
            </div>

            {/* the swap terms */}
            <div className="flex flex-wrap items-center gap-2 text-[13px] mb-3">
              <span className="font-mono text-ink-0">
                {payload.from_amount} {payload.from_currency}
              </span>
              <ArrowRight size={14} className="text-live-500" />
              <span className="font-mono text-ink-0">
                {payload.to_amount} {payload.to_currency}
              </span>
              <span className="text-[11px] text-ink-3 font-mono">
                rate {payload.rate} · fee {payload.fee} ({payload.fee_percent}%)
              </span>
            </div>

            {/* hashes + provenance-on-pull */}
            <div className="space-y-1 text-[11px] font-mono text-ink-3 break-all mb-3">
              {payload.deposit_tx_hash && (
                <p>
                  <span className="text-ink-4">deposit tx</span> {payload.deposit_tx_hash}
                </p>
              )}
              {payload.withdrawal_tx_hash && (
                <p>
                  <span className="text-ink-4">withdrawal tx</span> {payload.withdrawal_tx_hash}
                </p>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-ink-4">payload hash</span>
                <Provenance
                  rows={[
                    { k: 'key id', v: receipt.key_id ?? truncateHash(receipt.public_key, 8) },
                    { k: 'algorithm', v: 'Ed25519 (RFC 8032)' },
                    { k: 'canonical', v: 'JSON · sorted keys · compact' },
                    { k: 'hash', v: 'SHA-256' },
                    { k: 'post-quantum', v: result.hasPqSignature ? 'ML-DSA-65 (FIPS 204)' : 'none' },
                  ]}
                >
                  <span className="text-ink-1">{truncateHash(result.payloadHash, 16)}</span>
                </Provenance>
              </div>
            </div>

            {/* every check as an ok/critical row */}
            <ul className="space-y-1.5 pt-3 border-t border-surface-border">
              <CheckRow ok={result.canonicalMatches}>
                Canonical JSON matches local re-canonicalization
              </CheckRow>
              <CheckRow ok={result.hashMatches}>
                SHA-256 of canonical payload matches payload_hash
              </CheckRow>
              <CheckRow ok={result.signatureValid}>
                Ed25519 signature valid over canonical payload
              </CheckRow>
              <CheckRow tone={result.hasPqSignature ? 'watch' : 'stale'} ok={result.hasPqSignature}>
                {result.hasPqSignature
                  ? 'ML-DSA-65 post-quantum signature attached · verify offline'
                  : 'No post-quantum signature attached'}
              </CheckRow>
              <CheckRow ok={result.chainLinks}>
                {i === 0
                  ? payload.sequence === 0
                    ? 'Hash chain anchors to the genesis hash'
                    : `Hash chain starts at sequence ${payload.sequence} (partial history)`
                  : 'Hash chain links to the previous receipt'}
              </CheckRow>
              {result.pinMatches !== null && (
                <CheckRow ok={result.pinMatches}>
                  {result.pinMatches
                    ? 'Signed by your pinned key'
                    : 'Signed by a DIFFERENT key than your pin'}
                </CheckRow>
              )}
            </ul>
          </DecisionCard>
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
          throw new Error(`Could not reach the bridge API: ${err.message || 'network error'}`);
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
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-12">
      {/* Trust strip — the property that matters here: nothing you paste leaves the browser */}
      <TrustStrip
        items={[
          { label: 'crypto', value: 'client-side', dot: 'var(--tk-ok)' },
          { label: 'network', value: 'zero' },
          { label: 'verifies', value: 'ed25519 + merkle' },
          { label: 'env', value: API_HOST },
        ]}
      />

      <Reveal className="mt-8 mb-8">
        <div className="flex items-center gap-2.5 mb-2">
          <ShieldCheck size={22} className="text-live-500" />
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink-0">
            Verify a receipt
          </h1>
        </div>
        <p className="text-ink-2 max-w-2xl leading-relaxed">
          Check the bridge&apos;s signed swap receipts against its own promises. All cryptography
          runs locally in your browser. Nothing you paste here is sent anywhere.
        </p>
      </Reveal>

      {/* Offline verifier note */}
      <Reveal className="mb-6">
        <DecisionCard tone="watch">
          <div className="flex items-start gap-3">
            <Download size={18} className="shrink-0 mt-0.5 text-live-500" />
            <p className="text-[13px] text-ink-2 leading-relaxed">
              Don&apos;t want to trust this website either?{' '}
              <a
                href={OFFLINE_VERIFIER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-live-500 hover:text-live-400 font-medium underline underline-offset-2"
              >
                Download umbra-verify.html
              </a>{' '}
              — a single self-contained file you open from your own disk. It makes zero network
              requests and verifies the same receipts, checkpoints, and Merkle inclusion proofs.
            </p>
          </div>
        </DecisionCard>
      </Reveal>

      {/* Input */}
      <Reveal className="mb-6">
        <Panel
          title="Look up or paste a receipt"
          right={
            <div className="flex gap-2">
              <button
                className={`tk-btn ${mode === 'order' ? 'tk-btn--live' : ''}`}
                style={{ padding: '6px 11px', fontSize: 12 }}
                onClick={() => setMode('order')}
              >
                <Search size={13} /> Order ID
              </button>
              <button
                className={`tk-btn ${mode === 'json' ? 'tk-btn--live' : ''}`}
                style={{ padding: '6px 11px', fontSize: 12 }}
                onClick={() => setMode('json')}
              >
                <FileJson size={13} /> Raw JSON
              </button>
            </div>
          }
        >
          {mode === 'order' ? (
            <div>
              <label htmlFor="order-id" className="tk-label">
                Order ID
              </label>
              <div className="tk-terminal">
                <Search size={15} className="text-ink-3 shrink-0" />
                <input
                  id="order-id"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runVerification()}
                  placeholder="Paste your order ID — receipts are fetched, then verified in your browser"
                />
              </div>
              <p className="text-[11px] text-ink-3 mt-1.5">
                The API only supplies the data; every signature check happens client-side.
              </p>
            </div>
          ) : (
            <div>
              <label htmlFor="raw-receipt-json" className="tk-label">
                Receipt JSON
              </label>
              <textarea
                id="raw-receipt-json"
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                placeholder="Paste the full response of GET /v1/proof/receipt/<order_id>, a single receipt object, or an array of receipts"
                rows={8}
                className="w-full rounded-md border border-surface-border text-ink-1 placeholder:text-ink-4 font-mono text-[11.5px] p-3.5 mt-1 resize-y focus:border-live-600 focus:outline-none"
                style={{ background: '#020202' }}
              />
              <p className="text-[11px] text-ink-3 mt-1">
                Fully offline: pasted JSON never leaves your browser.
              </p>
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-surface-border">
            <label htmlFor="pinned-key" className="tk-label">
              Pinned public key <span className="text-ink-4 normal-case tracking-normal">· optional but recommended</span>
            </label>
            <div className="tk-terminal">
              <KeyRound size={15} className="text-ink-3 shrink-0" />
              <input
                id="pinned-key"
                value={pinnedKey}
                onChange={(e) => handlePinnedKeyChange(e.target.value)}
                placeholder="64 hex chars from /v1/proof/key — obtain it out-of-band and keep it"
              />
            </div>
            <p className="text-[11px] text-ink-3 mt-1.5 leading-relaxed">
              If set, every signature must be made by exactly this key. Without a pin, verification
              proves internal consistency but not who signed. Stored only in your browser.
            </p>
          </div>

          <button className="tk-btn tk-btn--live mt-4" onClick={runVerification} disabled={loading}>
            <ShieldCheck size={15} /> {loading ? 'Verifying…' : 'Verify receipts'}
          </button>
        </Panel>
      </Reveal>

      {/* Error — fail loud */}
      {error && (
        <div className="tk-card tk-card--critical mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--tk-critical)' }} />
            <p className="text-[13px]" style={{ color: 'var(--tk-critical)' }}>
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Verdict */}
      {verdict && receipts && (
        <>
          <DecisionCard
            className="mb-6"
            tone={verdict.ok ? 'ok' : 'critical'}
            title={<>Verdict</>}
            chip={<Chip tone={verdict.ok ? 'ok' : 'critical'}>{verdict.ok ? 'verified ✓' : 'failed'}</Chip>}
          >
            <div className="tk-hero">
              {verdict.ok ? (
                <>
                  <span className="tk-hero__value" style={{ color: 'var(--tk-ok)' }}>
                    {receipts.length}
                  </span>
                  <span className="tk-hero__unit">verified</span>
                  <ShieldCheck size={28} style={{ color: 'var(--tk-ok)' }} />
                </>
              ) : (
                <>
                  {/* fail loud: a receipt set that did not verify is struck through, never shown clean */}
                  <span className="tk-hero__value tk-hero__value--degraded">{receipts.length}</span>
                  <span className="tk-hero__unit">unverified</span>
                  <ShieldX size={28} style={{ color: 'var(--tk-critical)' }} />
                </>
              )}
            </div>
            <div className="tk-comprehend">
              {verdict.ok
                ? `All ${receipts.length} receipt${receipts.length === 1 ? '' : 's'} verified. This history is exactly what the bridge signed.`
                : 'Verification failed. Do not trust this receipt data.'}
            </div>

            {!verdict.ok && (
              <div className="tk-degraded">
                <ShieldX size={15} /> One or more cryptographic checks did not pass.
              </div>
            )}
            {!verdict.singleKey && (
              <p className="mt-3 pt-3 border-t border-surface-border text-[13px]" style={{ color: 'var(--tk-critical)' }}>
                Receipts are signed by multiple different keys — investigate.
              </p>
            )}
            {verdict.partialHistory && (
              <p className="mt-3 pt-3 border-t border-surface-border text-[13px]" style={{ color: 'var(--tk-warning)' }}>
                Partial history: the first pasted receipt is not sequence 0, so linkage to earlier
                receipts could not be checked.
              </p>
            )}
          </DecisionCard>

          <ReceiptTimeline receipts={receipts} verdict={verdict} />
        </>
      )}

      <div className="mt-10 text-center text-[13px] text-ink-3">
        <p>
          Explore the full proof layer on the{' '}
          <Link href="/transparency" className="text-live-500 hover:text-live-400">
            Transparency page
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
