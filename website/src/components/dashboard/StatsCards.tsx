'use client';

import { DollarSign, TrendingUp, Clock, Activity } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useStats } from '@/hooks/useApi';
import { formatNumber, formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

const statConfig = [
  {
    key: 'total_volume_usd',
    label: 'Total Volume',
    icon: DollarSign,
    format: (v: number) => formatCurrency(v),
    color: 'text-xmr-400',
    bgColor: 'bg-xmr-500/10',
  },
  {
    key: 'volume_24h_usd',
    label: '24h Volume',
    icon: TrendingUp,
    format: (v: number) => formatCurrency(v),
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
  },
  {
    key: 'active_orders',
    label: 'Active Orders',
    icon: Activity,
    format: (v: number) => formatNumber(v, 0),
    color: 'text-ton-400',
    bgColor: 'bg-ton-500/10',
  },
  {
    key: 'completed_orders',
    label: 'Completed',
    icon: Clock,
    format: (v: number) => formatNumber(v, 0),
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
  },
];

export function StatsCards() {
  const { data, isLoading } = useStats();

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {statConfig.map((stat) => {
        const Icon = stat.icon;
        const value = (data as Record<string, number>)?.[stat.key] || 0;

        return (
          <Card key={stat.key} hoverable>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">{stat.label}</p>
              <div className={cn('p-2 rounded-lg', stat.bgColor)}>
                <Icon size={16} className={stat.color} />
              </div>
            </div>
            <p className="text-2xl font-bold text-white animate-count">
              {stat.format(value)}
            </p>
          </Card>
        );
      })}
    </div>
  );
}

export default StatsCards;
