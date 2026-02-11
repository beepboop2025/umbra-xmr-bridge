'use client';

import Link from 'next/link';
import { Github, Twitter, MessageCircle, ExternalLink } from 'lucide-react';

const footerLinks = {
  Product: [
    { label: 'Bridge', href: '/bridge' },
    { label: 'Explorer', href: '/explorer' },
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'API Docs', href: '#' },
  ],
  Resources: [
    { label: 'How It Works', href: '/#how-it-works' },
    { label: 'Security', href: '/#security' },
    { label: 'FAQ', href: '#' },
    { label: 'Status Page', href: '#' },
  ],
  Legal: [
    { label: 'Terms of Service', href: '#' },
    { label: 'Privacy Policy', href: '#' },
    { label: 'No KYC Policy', href: '#' },
  ],
};

const socialLinks = [
  { icon: Github, href: '#', label: 'GitHub' },
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: MessageCircle, href: '#', label: 'Telegram' },
];

export function Footer() {
  return (
    <footer className="border-t border-surface-border bg-surface-base">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-xmr-500 to-xmr-700 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor">
                  <path d="M5 17V8l7 7 7-7v9h3V5l-1-1L12 13 3 4 2 5v12h3z" />
                </svg>
              </div>
              <span className="text-lg font-bold text-white">XMR<span className="text-xmr-400">Bridge</span></span>
            </div>
            <p className="text-sm text-gray-400 max-w-xs mb-4">
              Private, non-custodial multi-chain bridge for Monero. No KYC, no registration, just swap.
            </p>
            <div className="flex items-center gap-3">
              {socialLinks.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-surface-elevated transition-colors"
                    aria-label={social.label}
                  >
                    <Icon size={18} />
                  </a>
                );
              })}
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-white mb-3">{category}</h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-400 hover:text-xmr-400 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-surface-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-500">
            &copy; {new Date().getFullYear()} XMRBridge. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://getmonero.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-xmr-400 transition-colors"
            >
              Powered by Monero
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
