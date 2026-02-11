'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { VolumeChart } from '@/components/dashboard/VolumeChart';
import { OrdersTable } from '@/components/dashboard/OrdersTable';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function DashboardPage() {
  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-6 pb-24 md:pb-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">Overview of your bridge activity</p>
        </div>

        {/* Stats */}
        <StatsCards />

        {/* Charts */}
        <div className="mt-6">
          <VolumeChart />
        </div>

        {/* Recent Orders */}
        <div className="mt-6">
          <Card padding="none">
            <div className="p-5 flex items-center justify-between">
              <CardHeader title="Recent Orders" subtitle="Your latest bridge transactions" />
              <Link href="/dashboard/orders">
                <Button variant="ghost" size="sm" iconRight={<ArrowRight size={14} />}>
                  View All
                </Button>
              </Link>
            </div>
            <OrdersTable limit={5} showPagination={false} compact />
          </Card>
        </div>
      </div>
    </div>
  );
}
