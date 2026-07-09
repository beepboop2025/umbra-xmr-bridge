'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Lock, Eye, Shield, Zap, ShieldCheck } from 'lucide-react';
import { useStats } from '@/hooks/useApi';
import { apiClient } from '@/lib/api-client';
import { LivingMap, type MapNode, type MapEdge } from '@/components/tikto/LivingMap';

// XMR at the hub, counterparties on a ring — the bridge as a topology.
const RING = [
  { s: 'BTC', c: '#f7931a' },
  { s: 'ETH', c: '#627eea' },
  { s: 'TON', c: '#0098ea' },
  { s: 'SOL', c: '#9945ff' },
  { s: 'ARB', c: '#28a0f0' },
  { s: 'BASE', c: '#0052ff' },
  { s: 'USDC', c: '#2775ca' },
  { s: 'USDT', c: '#26a17b' },
];
const MAP_NODES: MapNode[] = [
  { x: 0.5, y: 0.5, r: 9, label: 'XMR' },
  ...RING.map((ch, i) => {
    const a = (i / RING.length) * Math.PI * 2 - Math.PI / 2;
    return { x: 0.5 + Math.cos(a) * 0.4, y: 0.5 + Math.sin(a) * 0.42, r: 5, label: ch.s } as MapNode;
  }),
];
const MAP_EDGES: MapEdge[] = RING.map((_, i) => [0, i + 1, 0.4 + (i % 3) * 0.2] as MapEdge);

const VALUE = [
  { icon: Lock, title: 'MPC threshold custody', body: 'No single party ever holds funds. Withdrawals require t-of-n signatures. The circuit breaker halts intake the moment aggregate flow looks wrong.', tone: 'ok' as const },
  { icon: Eye, title: 'No KYC, ever', body: 'No email, no phone, no documents. The deposit receipt records a hash of your address, never the address itself.', tone: 'ok' as const },
  { icon: Shield, title: 'Native assets only', body: 'You receive real BTC on Bitcoin, real ETH on Ethereum. No wrapped IOUs, no bridge tokens to unwind.', tone: 'ok' as const },
  { icon: Zap, title: 'Non-custodial & provable', body: 'Every order emits an Ed25519 + post-quantum signed receipt you can verify offline against a published key.', tone: 'watch' as const },
];

export default function HomePage() {
  const { data: stats } = useStats();
  const [rate, setRate] = useState<{ rate: number; change?: number | null } | null>(null);

  useEffect(() => {
    apiClient
      .getRate('XMR', 'BTC')
      .then((r: any) => setRate({ rate: parseFloat(r.rate), change: r.change_24h }))
      .catch(() => setRate(null));
  }, []);

  const up = (rate?.change ?? 0) >= 0;

  return (
    <div className="pb-20 md:pb-6">
      {/* Trust strip — auditability always visible */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        <div className="tk-trust">
          <span className="tk-trust__item"><span className="tk-trust__dot" style={{ color: 'var(--tk-ok)' }} /> <b>live</b> · 8 chains</span>
          <span className="tk-trust__sep" />
          <span className="tk-trust__item">as of <b>now</b></span>
          <span className="tk-trust__sep" />
          <span className="tk-trust__item">custody <b>MPC 2-of-3</b></span>
          <span className="tk-trust__sep" />
          <span className="tk-trust__item">receipts <b>ed25519 + ml-dsa</b></span>
          <span className="tk-trust__sep" />
          <Link href="/verify" className="tk-trust__item" style={{ color: 'var(--tk-live)' }}>verify a receipt →</Link>
        </div>
      </div>

      {/* Hero: statement + live-rate decision card | living map */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold tracking-tight leading-[1.04] text-ink-0">
            Move Monero to any chain.
            <br />
            <span className="text-live-500">Private. Provable. Non-custodial.</span>
          </h1>
          <p className="mt-5 text-lg text-ink-2 max-w-xl">
            Umbra bridges XMR to BTC, ETH, TON, SOL and more — with threshold custody, a
            fail-loud circuit breaker, and a signed receipt for every swap. No KYC. No account.
          </p>

          {/* live-rate decision card */}
          <div className="tk-card tk-card--ok mt-8 max-w-md">
            <div className="tk-card__head">
              <span className="tk-card__title">XMR → BTC · live rate</span>
              <span className="tk-chip tk-chip--ok">● streaming</span>
            </div>
            <div className="tk-hero">
              <span className="tk-hero__value">{rate ? rate.rate.toFixed(6) : '——'}</span>
              <span className="tk-hero__unit">BTC</span>
              {rate?.change != null && (
                <span className={`tk-hero__delta ${up ? 'tk-hero__delta--up' : 'tk-hero__delta--down'}`}>
                  {up ? '▲' : '▼'} {Math.abs(rate.change).toFixed(2)}%
                </span>
              )}
            </div>
            <div className="tk-project">per 1 XMR · aggregated across CoinGecko + Kraken</div>
            <Link href="/bridge" className="tk-action" style={{ borderStyle: 'solid', borderColor: 'var(--tk-live)', color: 'var(--tk-live)' }}>
              <ArrowRight size={15} /> Start a swap — quote locks for 30 min
            </Link>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Link href="/bridge" className="tk-btn tk-btn--live">Start Bridging <ArrowRight size={15} /></Link>
            <Link href="/explorer" className="tk-btn">Open Explorer</Link>
          </div>
        </div>

        {/* the living map — the signature */}
        <div>
          <div className="tk-panel">
            <div className="flex items-center justify-between mb-3">
              <span className="tk-panel__title" style={{ margin: 0 }}>Liquidity network</span>
              <span className="tk-label">navigable space</span>
            </div>
            <LivingMap nodes={MAP_NODES} edges={MAP_EDGES} height={380} />
          </div>
        </div>
      </section>

      {/* Live metrics — tabular, calm */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-14">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-surface-border rounded-[14px] overflow-hidden border border-surface-border">
          {[
            { label: 'Total volume', value: stats ? `$${Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(stats.total_volume_usd)}` : '——' },
            { label: '24h volume', value: stats ? `$${Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(stats.volume_24h_usd)}` : '——' },
            { label: 'Orders', value: stats ? String(stats.total_orders) : '——' },
            { label: 'Chains', value: String(stats?.supported_chains ?? 6) },
          ].map((m) => (
            <div key={m.label} className="bg-surface-base px-5 py-6">
              <div className="tk-label">{m.label}</div>
              <div className="tk-num text-2xl font-bold text-ink-0 mt-1.5">{m.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Value props — decision cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-16">
        <div className="flex items-center gap-3 mb-6">
          <ShieldCheck size={16} className="text-live-500" />
          <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-ink-3">Designed for the worst moment</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {VALUE.map((v) => {
            const Icon = v.icon;
            return (
              <div key={v.title} className={`tk-card tk-card--${v.tone}`}>
                <div className="flex gap-4">
                  <div className="w-11 h-11 rounded-[11px] flex items-center justify-center shrink-0" style={{ background: 'var(--tk-surface-3)', border: '1px solid var(--tk-line-2)' }}>
                    <Icon size={20} className="text-live-500" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold text-ink-0 mb-1.5">{v.title}</h3>
                    <p className="text-[13px] text-ink-2 leading-relaxed">{v.body}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works — the flow */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-16">
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-ink-3 mb-6">Four steps · ~12 min</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            ['01', 'Choose a pair', 'Pick XMR and a destination. No registration.'],
            ['02', 'Send XMR', 'Send Monero to the generated deposit subaddress.'],
            ['03', 'Threshold sign', 'The deposit confirms; MPC signs the withdrawal.'],
            ['04', 'Receive native', 'Real assets arrive at your destination. A signed receipt is issued.'],
          ].map(([n, t, d]) => (
            <div key={n} className="tk-panel relative">
              <div className="tk-num absolute top-3 right-4 text-2xl font-extrabold" style={{ color: 'var(--tk-line-3)' }}>{n}</div>
              <h3 className="text-[15px] font-bold text-ink-0 mb-2 mt-1">{t}</h3>
              <p className="text-[13px] text-ink-2 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-16">
        <div className="tk-card tk-card--ok text-center py-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-ink-0">Ready to bridge?</h2>
          <p className="text-ink-2 mt-3 mb-7">Swap XMR privately in under a minute. No account needed.</p>
          <Link href="/bridge" className="tk-btn tk-btn--live" style={{ padding: '12px 22px' }}>Launch Bridge <ArrowRight size={16} /></Link>
        </div>
      </section>
    </div>
  );
}
