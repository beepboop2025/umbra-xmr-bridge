'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Activity, ArrowLeftRight, LayoutDashboard, Search, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { TonConnectButton } from '@/components/wallet/TonConnectButton';

const navLinks = [
  { href: '/', label: 'Home', icon: Activity },
  { href: '/bridge', label: 'Bridge', icon: ArrowLeftRight },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/explorer', label: 'Explorer', icon: Search },
];

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-surface-border bg-surface-deep/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative w-9 h-9">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-xmr-500 to-xmr-700 opacity-80 group-hover:opacity-100 transition-opacity" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
                  <path d="M5 17V8l7 7 7-7v9h3V5l-1-1L12 13 3 4 2 5v12h3z" />
                </svg>
              </div>
            </div>
            <div className="hidden sm:block">
              <span className="text-lg font-bold text-white">XMR</span>
              <span className="text-lg font-bold text-xmr-400">Bridge</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href ||
                (link.href !== '/' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'text-xmr-400 bg-xmr-500/10'
                      : 'text-gray-400 hover:text-white hover:bg-surface-elevated'
                  )}
                >
                  <Icon size={16} />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Right section */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-surface-border">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-gray-400">Live</span>
            </div>
            <div className="hidden sm:block">
              <TonConnectButton />
            </div>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-surface-elevated transition-colors"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-surface-border bg-surface-base">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href ||
                (link.href !== '/' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'text-xmr-400 bg-xmr-500/10'
                      : 'text-gray-400 hover:text-white hover:bg-surface-elevated'
                  )}
                >
                  <Icon size={18} />
                  {link.label}
                </Link>
              );
            })}
            <div className="pt-3 border-t border-surface-border">
              <TonConnectButton />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export default Header;
