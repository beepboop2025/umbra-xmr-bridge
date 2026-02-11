'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ArrowLeftRight,
  ClipboardList,
  BarChart3,
  Wallet,
  Shield,
  FileText,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const dashboardLinks = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/orders', label: 'Orders', icon: ClipboardList },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/wallets', label: 'Wallets', icon: Wallet },
];

const adminLinks = [
  { href: '/admin', label: 'System', icon: Shield, exact: true },
  { href: '/admin/orders', label: 'Manage Orders', icon: ClipboardList },
  { href: '/admin/audit', label: 'Audit Log', icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith('/admin');
  const links = isAdmin ? adminLinks : dashboardLinks;
  const title = isAdmin ? 'Admin Panel' : 'Dashboard';

  return (
    <aside className="hidden lg:flex flex-col w-60 border-r border-surface-border bg-surface-base min-h-[calc(100vh-4rem)]">
      <div className="p-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider px-3 mb-3">
          {title}
        </h2>
        <nav className="space-y-1">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'text-xmr-400 bg-xmr-500/10 border-l-2 border-xmr-500'
                    : 'text-gray-400 hover:text-white hover:bg-surface-elevated border-l-2 border-transparent'
                )}
              >
                <Icon size={18} />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {!isAdmin && (
          <>
            <div className="my-4 border-t border-surface-border" />
            <Link
              href="/bridge"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-xmr-400 bg-xmr-500/5 border border-xmr-500/20 hover:bg-xmr-500/10 transition-colors"
            >
              <ArrowLeftRight size={18} />
              New Bridge
            </Link>
          </>
        )}
      </div>

      {/* Status indicator */}
      <div className="mt-auto p-4 border-t border-surface-border">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-card">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="text-xs text-gray-400">All Systems Operational</span>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
