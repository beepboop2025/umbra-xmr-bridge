'use client';

import {
  Activity,
  Server,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Wallet,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useSystemHealth } from '@/hooks/useApi';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { formatNumber } from '@/lib/utils';
import { CHAINS } from '@/lib/chains';
import { cn } from '@/lib/utils';

export default function AdminPage() {
  const { data: health, isLoading } = useSystemHealth();

  if (isLoading && !health) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 p-6 max-w-6xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const uptime = health ? Math.floor(health.uptime / 86400) : 0;
  const uptimeHours = health ? Math.floor((health.uptime % 86400) / 3600) : 0;

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-6 pb-24 md:pb-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">System Administration</h1>
          <p className="text-sm text-gray-400 mt-1">Monitor system health and manage operations</p>
        </div>

        {/* Status Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">System Status</p>
              <div className={cn('p-2 rounded-lg', health?.status === 'healthy' ? 'bg-green-500/10' : 'bg-red-500/10')}>
                {health?.status === 'healthy' ? (
                  <CheckCircle size={16} className="text-green-400" />
                ) : (
                  <XCircle size={16} className="text-red-400" />
                )}
              </div>
            </div>
            <Badge variant={health?.status === 'healthy' ? 'success' : 'error'} dot pulse size="md">
              {health?.status === 'healthy' ? 'All Systems Operational' : 'Issues Detected'}
            </Badge>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">Uptime</p>
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Clock size={16} className="text-blue-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{uptime}d {uptimeHours}h</p>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">Pending Orders</p>
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Activity size={16} className="text-yellow-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{health?.pending_orders || 0}</p>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">Services</p>
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Server size={16} className="text-purple-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white">
              {health?.services ? Object.keys(health.services).length : 0}
            </p>
          </Card>
        </div>

        {/* Services Grid */}
        <Card className="mt-6">
          <CardHeader title="Service Health" subtitle="Real-time service status" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health?.services &&
              Object.entries(health.services).map(([name, service]) => (
                <div
                  key={name}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-surface-border"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-2.5 h-2.5 rounded-full',
                        service.status === 'healthy' ? 'bg-green-400' : 'bg-red-400'
                      )}
                    />
                    <div>
                      <p className="text-sm font-medium text-white capitalize">
                        {name.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-gray-500">{service.latency}ms</p>
                    </div>
                  </div>
                  <Badge
                    variant={service.status === 'healthy' ? 'success' : 'error'}
                    size="sm"
                  >
                    {service.status}
                  </Badge>
                </div>
              ))}
          </div>
        </Card>

        {/* Wallet Balances */}
        <Card className="mt-6">
          <CardHeader title="Hot Wallet Balances" subtitle="Current bridge wallet balances" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health?.wallet_balances &&
              Object.entries(health.wallet_balances).map(([chain, balance]) => {
                const chainData = CHAINS[chain];
                return (
                  <div
                    key={chain}
                    className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-surface-border"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                        style={{
                          backgroundColor: `${chainData?.color || '#888'}20`,
                          color: chainData?.color || '#888',
                        }}
                      >
                        {chain.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{chainData?.name || chain}</p>
                        <p className="text-xs text-gray-500">{chain}</p>
                      </div>
                    </div>
                    <p className="text-sm font-bold font-mono text-white">
                      {(Number(balance) || 0).toFixed(4)}
                    </p>
                  </div>
                );
              })}
          </div>
        </Card>

        {/* Alerts */}
        <Card className="mt-6">
          <CardHeader title="System Alerts" subtitle="Recent alerts and warnings" />
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
              <AlertTriangle size={16} className="text-yellow-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-yellow-400">Low balance warning</p>
                <p className="text-xs text-yellow-400/60">BTC hot wallet below 1.0 BTC threshold</p>
              </div>
              <span className="text-xs text-gray-500">2h ago</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-elevated border border-surface-border">
              <CheckCircle size={16} className="text-green-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-gray-300">Rate feed recovered</p>
                <p className="text-xs text-gray-500">CoinGecko API connection restored</p>
              </div>
              <span className="text-xs text-gray-500">5h ago</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-elevated border border-surface-border">
              <Activity size={16} className="text-blue-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-gray-300">High volume detected</p>
                <p className="text-xs text-gray-500">24h volume exceeded $1M threshold</p>
              </div>
              <span className="text-xs text-gray-500">12h ago</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
