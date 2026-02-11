'use client';

import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { useVolumeHistory } from '@/hooks/useApi';
import { SkeletonChart } from '@/components/ui/Skeleton';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

const periods = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
];

export function VolumeChart() {
  const [period, setPeriod] = useState('7d');
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');
  const { data, isLoading } = useVolumeHistory(period);

  if (isLoading && !data) {
    return <SkeletonChart />;
  }

  const chartData = (data?.points || []).map((p) => ({
    date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    volume: Math.round(p.volume),
    count: p.count,
  }));

  return (
    <Card>
      <div className="flex items-center justify-between mb-6">
        <CardHeader title="Bridge Volume" subtitle="Total volume over time" />
        <div className="flex items-center gap-2">
          <div className="flex bg-surface-elevated rounded-lg p-1">
            {periods.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  period === p.key
                    ? 'bg-xmr-500 text-white'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'area' ? (
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FF6600" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#FF6600" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2640" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#505a70"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#505a70"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
                width={55}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f1424',
                  border: '1px solid #1e2640',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#8892a8' }}
                formatter={(value: number) => [formatCurrency(value), 'Volume']}
              />
              <Area
                type="monotone"
                dataKey="volume"
                stroke="#FF6600"
                strokeWidth={2}
                fill="url(#volumeGradient)"
              />
            </AreaChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2640" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#505a70"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#505a70"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
                width={55}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f1424',
                  border: '1px solid #1e2640',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: number) => [formatCurrency(value), 'Volume']}
              />
              <Bar dataKey="volume" fill="#FF6600" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export default VolumeChart;
