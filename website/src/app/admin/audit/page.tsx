'use client';

import { useState } from 'react';
import { Search, Filter, Shield, User, Clock, Globe } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, Pagination, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target?: string;
  details: string;
  timestamp: string;
  ip?: string;
}

// Mock audit data
const mockAuditData: AuditEntry[] = [
  {
    id: 'aud_001',
    action: 'order.created',
    actor: 'system',
    target: 'ord_1042',
    details: 'New bridge order created: 2.5 XMR -> ETH',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    ip: '192.168.1.1',
  },
  {
    id: 'aud_002',
    action: 'order.completed',
    actor: 'system',
    target: 'ord_1041',
    details: 'Order completed successfully. Payout sent.',
    timestamp: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: 'aud_003',
    action: 'wallet.rebalance',
    actor: 'admin',
    details: 'Hot wallet rebalanced: Moved 1.5 BTC to cold storage',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    ip: '10.0.0.1',
  },
  {
    id: 'aud_004',
    action: 'rate.updated',
    actor: 'system',
    details: 'XMR/BTC rate updated: 0.00285 -> 0.00287',
    timestamp: new Date(Date.now() - 5400000).toISOString(),
  },
  {
    id: 'aud_005',
    action: 'order.expired',
    actor: 'system',
    target: 'ord_1039',
    details: 'Order expired: No deposit received within 30 minutes',
    timestamp: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'aud_006',
    action: 'admin.login',
    actor: 'admin',
    details: 'Admin login from trusted IP',
    timestamp: new Date(Date.now() - 10800000).toISOString(),
    ip: '10.0.0.1',
  },
  {
    id: 'aud_007',
    action: 'config.updated',
    actor: 'admin',
    details: 'Updated fee configuration: bridge_fee from 0.5% to 0.45%',
    timestamp: new Date(Date.now() - 14400000).toISOString(),
    ip: '10.0.0.1',
  },
  {
    id: 'aud_008',
    action: 'order.refunded',
    actor: 'system',
    target: 'ord_1035',
    details: 'Order refunded: Destination chain network congestion',
    timestamp: new Date(Date.now() - 18000000).toISOString(),
  },
  {
    id: 'aud_009',
    action: 'alert.triggered',
    actor: 'system',
    details: 'Low balance alert: BTC wallet below threshold (0.8 BTC)',
    timestamp: new Date(Date.now() - 21600000).toISOString(),
  },
  {
    id: 'aud_010',
    action: 'service.restart',
    actor: 'admin',
    details: 'Restarted monero_rpc service after connection timeout',
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    ip: '10.0.0.1',
  },
];

const actionOptions = [
  { value: 'all', label: 'All Actions' },
  { value: 'order', label: 'Orders' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'admin', label: 'Admin' },
  { value: 'rate', label: 'Rates' },
  { value: 'config', label: 'Config' },
  { value: 'alert', label: 'Alerts' },
  { value: 'service', label: 'Service' },
];

const actionColors: Record<string, string> = {
  'order.created': 'text-blue-400',
  'order.completed': 'text-green-400',
  'order.expired': 'text-yellow-400',
  'order.refunded': 'text-orange-400',
  'order.failed': 'text-red-400',
  'wallet.rebalance': 'text-purple-400',
  'rate.updated': 'text-cyan-400',
  'admin.login': 'text-gray-300',
  'config.updated': 'text-amber-400',
  'alert.triggered': 'text-red-400',
  'service.restart': 'text-blue-400',
};

export default function AuditLogPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  const filteredEntries = mockAuditData.filter((entry) => {
    if (actionFilter !== 'all' && !entry.action.startsWith(actionFilter)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        entry.action.toLowerCase().includes(q) ||
        entry.details.toLowerCase().includes(q) ||
        entry.actor.toLowerCase().includes(q) ||
        (entry.target || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const columns: Column<AuditEntry>[] = [
    {
      key: 'timestamp',
      header: 'Time',
      sortable: true,
      width: '140px',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-gray-600" />
          <span className="text-xs text-gray-400">{formatDate(row.timestamp)}</span>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      sortable: true,
      width: '160px',
      render: (row) => (
        <code
          className={cn(
            'text-xs font-mono px-2 py-1 rounded bg-surface-elevated',
            actionColors[row.action] || 'text-gray-400'
          )}
        >
          {row.action}
        </code>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      width: '100px',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          {row.actor === 'admin' ? (
            <Shield size={12} className="text-xmr-400" />
          ) : (
            <User size={12} className="text-gray-500" />
          )}
          <span className="text-xs text-gray-300">{row.actor}</span>
        </div>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      render: (row) => (
        <div>
          <p className="text-sm text-gray-300">{row.details}</p>
          {row.target && (
            <span className="text-xs font-mono text-xmr-400/60">{row.target}</span>
          )}
        </div>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      width: '110px',
      align: 'right',
      render: (row) =>
        row.ip ? (
          <div className="flex items-center gap-1 justify-end">
            <Globe size={10} className="text-gray-600" />
            <span className="text-xs font-mono text-gray-500">{row.ip}</span>
          </div>
        ) : (
          <span className="text-xs text-gray-700">-</span>
        ),
    },
  ];

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-6 pb-24 md:pb-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          <p className="text-sm text-gray-400 mt-1">
            Complete record of all system actions and events
          </p>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search audit log..."
                icon={<Search size={16} />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-40">
              <Select
                options={actionOptions}
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Events', count: filteredEntries.length, color: 'text-white' },
            { label: 'Orders', count: filteredEntries.filter((e) => e.action.startsWith('order')).length, color: 'text-blue-400' },
            { label: 'Admin Actions', count: filteredEntries.filter((e) => e.actor === 'admin').length, color: 'text-xmr-400' },
            { label: 'Alerts', count: filteredEntries.filter((e) => e.action.startsWith('alert')).length, color: 'text-red-400' },
          ].map((stat) => (
            <div key={stat.label} className="p-3 rounded-lg bg-surface-card border border-surface-border">
              <p className="text-xs text-gray-500">{stat.label}</p>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Audit Table */}
        <Card padding="none">
          <Table
            data={filteredEntries}
            columns={columns}
            emptyMessage="No audit entries found"
          />
        </Card>

        {/* Info */}
        <div className="mt-6 p-4 rounded-xl bg-surface-card border border-surface-border">
          <div className="flex gap-3">
            <Shield size={16} className="text-gray-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-gray-300">Tamper-evident audit trail</p>
              <p className="text-xs text-gray-500 mt-1">
                All audit entries are cryptographically chained. Each entry includes a hash of the previous entry
                to ensure the log cannot be modified without detection.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
