'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ArrowLeftRight, LayoutDashboard, Search, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/bridge', label: 'Bridge', icon: ArrowLeftRight },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/explorer', label: 'Explorer', icon: Search },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-surface-base/95 backdrop-blur-xl border-t border-surface-border">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 w-full h-full text-xs font-medium transition-colors',
                isActive ? 'text-xmr-400' : 'text-gray-500'
              )}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default MobileNav;
