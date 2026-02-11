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
} from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { useRateHistory } from '@/hooks/useRate';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

interface PriceChartProps {
  source?: string;
  dest?: string;
  className?: string;
}

const periods = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
];

export function PriceChart({ source, dest, className }: PriceChartProps) {
  const [period, setPeriod] = useState('24h');
  const { history, change24h, isLoading } = useRateHistory(source, dest, period);

  const data = history.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    rate: Number(p.rate.toFixed(8)),
  }));

  const isPositive = change24h >= 0;

  if (isLoading && data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader title="Rate History" />
        <Skeleton className="h-48 w-full" rounded="xl" />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-gray-400">Rate History</h3>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold text-white">
              {data.length > 0 ? data[data.length - 1]?.rate : '—'}
            </span>
            <span
              className={cn(
                'text-sm font-medium',
                isPositive ? 'text-green-400' : 'text-red-400'
              )}
            >
              {isPositive ? '+' : ''}
              {change24h.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-surface-elevated rounded-lg p-1">
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

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="rateGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
                <stop offset="100%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2640" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#505a70"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="#505a70"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              width={60}
              tickFormatter={(v: number) => v.toFixed(6)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f1424',
                border: '1px solid #1e2640',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelStyle={{ color: '#8892a8' }}
              itemStyle={{ color: isPositive ? '#22c55e' : '#ef4444' }}
            />
            <Area
              type="monotone"
              dataKey="rate"
              stroke={isPositive ? '#22c55e' : '#ef4444'}
              strokeWidth={2}
              fill="url(#rateGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export default PriceChart;
