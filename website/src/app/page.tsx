'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  Shield,
  Zap,
  Lock,
  Eye,
  ArrowLeftRight,
  CheckCircle,
  Clock,
  Send,
  Wallet,
  TrendingUp,
  Activity,
  DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useStats } from '@/hooks/useApi';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { COUNTERPARTY_CHAINS } from '@/lib/chains';

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

const stagger = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const steps = [
  {
    icon: Wallet,
    title: 'Choose Pair',
    description: 'Select XMR and your destination chain. No registration needed.',
    color: 'text-xmr-400',
    bg: 'bg-xmr-500/10',
  },
  {
    icon: Send,
    title: 'Send XMR',
    description: 'Send Monero to the generated deposit address. Completely private.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    icon: Clock,
    title: 'Wait for Confirmation',
    description: 'Our MPC system processes your swap in ~12 minutes.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  {
    icon: CheckCircle,
    title: 'Receive Funds',
    description: 'Native assets arrive at your destination address. Done.',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
  },
];

const securityFeatures = [
  {
    icon: Lock,
    title: 'MPC Security',
    description:
      'Multi-party computation ensures no single entity controls funds. Threshold signatures protect every transaction.',
  },
  {
    icon: Eye,
    title: 'No KYC Required',
    description:
      'We never ask for your identity. No email, no phone, no documents. Privacy is a right, not a privilege.',
  },
  {
    icon: Shield,
    title: 'Native Assets Only',
    description:
      'You receive native tokens, not wrapped versions. BTC on Bitcoin, ETH on Ethereum, TON on TON.',
  },
  {
    icon: Zap,
    title: 'Non-Custodial',
    description:
      'Your funds are never held by a central party. Atomic swaps and time-locked contracts protect your assets.',
  },
];

export default function HomePage() {
  const { data: stats } = useStats();

  return (
    <div className="pb-16 md:pb-0">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-gradient-to-b from-xmr-500/5 via-transparent to-transparent" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-xmr-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-ton-500/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-32">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-center max-w-3xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-xmr-500/10 border border-xmr-500/20 mb-8">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-sm text-xmr-400 font-medium">Live on 8+ Chains</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
              <span className="text-white">Bridge XMR to Any Chain</span>
              <br />
              <span className="bg-gradient-to-r from-xmr-400 via-xmr-500 to-ton-500 bg-clip-text text-transparent">
                Private, Fast, Non-Custodial
              </span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto">
              The most private multi-chain bridge. Swap Monero to BTC, ETH, TON, SOL, and more.
              No KYC. No registration. Just swap.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/bridge">
                <Button size="xl" iconRight={<ArrowRight size={18} />}>
                  Start Bridging
                </Button>
              </Link>
              <Link href="/explorer">
                <Button variant="secondary" size="xl">
                  View Explorer
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Live Stats Bar */}
      <section className="border-y border-surface-border bg-surface-base/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-surface-border"
          >
            {[
              {
                label: 'Total Volume',
                value: formatCurrency(stats?.total_volume_usd || 12450000),
                icon: DollarSign,
              },
              {
                label: '24h Volume',
                value: formatCurrency(stats?.volume_24h_usd || 890000),
                icon: TrendingUp,
              },
              {
                label: 'Active Orders',
                value: formatNumber(stats?.active_orders || 42, 0),
                icon: Activity,
              },
              {
                label: 'Completed',
                value: formatNumber(stats?.completed_orders || 15230, 0),
                icon: CheckCircle,
              },
            ].map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div key={index} className="py-5 px-4 sm:px-6 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Icon size={14} className="text-gray-500" />
                    <p className="text-xs text-gray-500 uppercase tracking-wider">{stat.label}</p>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-white">{stat.value}</p>
                </div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* Supported Chains */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <motion.div
          {...fadeInUp}
          className="text-center mb-12"
        >
          <h2 className="text-3xl font-bold text-white">Supported Chains</h2>
          <p className="mt-3 text-gray-400">
            Bridge XMR to and from the most popular blockchains
          </p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
        >
          {COUNTERPARTY_CHAINS.map((chain) => (
            <motion.div key={chain.id} variants={fadeInUp}>
              <Card hoverable className="text-center py-6">
                <div
                  className="w-12 h-12 mx-auto mb-3 rounded-xl flex items-center justify-center text-white text-xl font-bold"
                  style={{ backgroundColor: `${chain.color}20` }}
                >
                  {chain.icon ? (
                    <Image src={chain.icon} alt={chain.name} width={28} height={28} />
                  ) : (
                    <span style={{ color: chain.color }}>{chain.symbol.charAt(0)}</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-white">{chain.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {chain.symbol}
                  {chain.network && ` (${chain.network})`}
                </p>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-surface-base/50 border-y border-surface-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <motion.div {...fadeInUp} className="text-center mb-14">
            <h2 className="text-3xl font-bold text-white">How It Works</h2>
            <p className="mt-3 text-gray-400">
              Four simple steps to bridge your Monero privately
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.15 }}
                >
                  <Card className="relative h-full">
                    <div className="absolute top-4 right-4 text-3xl font-bold text-surface-border">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className={`w-12 h-12 rounded-xl ${step.bg} flex items-center justify-center mb-4`}>
                      <Icon size={24} className={step.color} />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
                    <p className="text-sm text-gray-400">{step.description}</p>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <motion.div {...fadeInUp} className="text-center mb-14">
          <h2 className="text-3xl font-bold text-white">Built for Privacy</h2>
          <p className="mt-3 text-gray-400 max-w-xl mx-auto">
            Every design decision prioritizes your privacy and security. No compromises.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {securityFeatures.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Card hoverable className="h-full">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-xl bg-xmr-500/10 flex items-center justify-center shrink-0">
                      <Icon size={24} className="text-xmr-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                      <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <Card gradient className="text-center py-12 sm:py-16">
          <div className="max-w-lg mx-auto">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-xmr-500 to-xmr-700 flex items-center justify-center">
              <ArrowLeftRight size={32} className="text-white" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Ready to Bridge?
            </h2>
            <p className="text-gray-400 mb-8">
              Start swapping XMR privately in under a minute. No account needed.
            </p>
            <Link href="/bridge">
              <Button size="xl" iconRight={<ArrowRight size={18} />}>
                Launch Bridge
              </Button>
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
