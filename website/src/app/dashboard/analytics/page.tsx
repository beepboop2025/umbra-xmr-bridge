'use client';

import { useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { useVolumeHistory, useStats } from '@/hooks/useApi';
import { useRateHistory } from '@/hooks/useRate';
import { formatCurrency } from '@/lib/utils';
import { COUNTERPARTY_CHAINS } from '@/lib/chains';
import { cn } from '@/lib/utils';

const periods = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
];

// Mock chain distribution data
const chainDistribution = [
  { name: 'BTC', value: 35, color: '#F7931A' },
  { name: 'ETH', value: 25, color: '#627EEA' },
  { name: 'TON', value: 18, color: '#0098EA' },
  { name: 'SOL', value: 10, color: '#9945FF' },
  { name: 'USDC', value: 7, color: '#2775CA' },
  { name: 'Other', value: 5, color: '#505a70' },
];

// Mock fee revenue data
const feeRevenue = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - (29 - i) * 86400000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }),
  fees: 200 + Math.random() * 800,
}));

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('7d');
  const { data: volumeData } = useVolumeHistory(period);
  const { history } = useRateHistory('XMR', 'BTC', '7d');

  const volumeChartData = (volumeData?.points || []).map((p) => ({
    date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    volume: Math.round(p.volume),
    count: p.count,
  }));

  const rateChartData = history.slice(-50).map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    rate: p.rate,
  }));

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-6 pb-24 md:pb-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-gray-400 mt-1">Bridge performance and statistics</p>
        </div>

        <StatsCards />

        {/* Period Selector */}
        <div className="mt-6 flex gap-2">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                period === p.key
                  ? 'bg-xmr-500 text-white'
                  : 'bg-surface-elevated text-gray-400 hover:text-white'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Volume Chart */}
        <Card className="mt-6">
          <CardHeader title="Volume Over Time" subtitle={`Last ${period === '7d' ? '7 days' : period === '30d' ? '30 days' : '90 days'}`} />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumeChartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <defs>
                  <linearGradient id="analyticsVolGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF6600" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#FF6600" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2640" vertical={false} />
                <XAxis dataKey="date" stroke="#505a70" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#505a70"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
                  width={55}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f1424', border: '1px solid #1e2640', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(value: number) => [formatCurrency(value), 'Volume']}
                />
                <Area type="monotone" dataKey="volume" stroke="#FF6600" strokeWidth={2} fill="url(#analyticsVolGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Rate History */}
          <Card>
            <CardHeader title="XMR/BTC Rate" subtitle="Last 7 days" />
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rateChartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <defs>
                    <linearGradient id="rateAnalyticsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0098EA" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#0098EA" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2640" vertical={false} />
                  <XAxis dataKey="time" stroke="#505a70" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis stroke="#505a70" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={60} tickFormatter={(v: number) => v.toFixed(5)} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f1424', border: '1px solid #1e2640', borderRadius: '8px', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="rate" stroke="#0098EA" strokeWidth={2} fill="url(#rateAnalyticsGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Chain Distribution */}
          <Card>
            <CardHeader title="Chain Distribution" subtitle="By volume" />
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chainDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {chainDistribution.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="middle"
                    align="right"
                    layout="vertical"
                    formatter={(value: string) => <span className="text-xs text-gray-400">{value}</span>}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1424', border: '1px solid #1e2640', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(value: number) => [`${value}%`, 'Share']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Fee Revenue */}
        <Card className="mt-6">
          <CardHeader title="Fee Revenue" subtitle="Daily bridge fees collected" />
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={feeRevenue} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2640" vertical={false} />
                <XAxis dataKey="date" stroke="#505a70" fontSize={10} tickLine={false} axisLine={false} interval={4} />
                <YAxis stroke="#505a70" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v.toFixed(0)}`} width={45} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f1424', border: '1px solid #1e2640', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(value: number) => [formatCurrency(value), 'Fees']}
                />
                <Bar dataKey="fees" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
