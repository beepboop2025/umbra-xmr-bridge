'use client';

import { useState, useEffect } from 'react';
import { Search, Filter, Shield, User, Clock, Globe, RefreshCw } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, Pagination, type Column } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import apiClient, { type AuditEntry } from '@/lib/api-client';

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
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAuditLog = async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.getAuditLog({
        page: currentPage,
        limit: 50,
        action: actionFilter !== 'all' ? actionFilter : undefined,
      });
      setEntries(data.entries);
      setTotal(data.total);
    } catch (e) {
      // Failed to fetch — keep existing data
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLog();
  }, [currentPage, actionFilter]);

  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      entry.action.toLowerCase().includes(q) ||
      entry.details.toLowerCase().includes(q) ||
      entry.actor.toLowerCase().includes(q) ||
      (entry.target || '').toLowerCase().includes(q)
    );
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Audit Log</h1>
            <p className="text-sm text-gray-400 mt-1">
              {total} total entries
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={fetchAuditLog}
            loading={isLoading}
          >
            Refresh
          </Button>
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
                Recorded audit entries include the previous entry&apos;s hash. Comparing the chain with retained signed
                checkpoints can expose later edits or gaps.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
