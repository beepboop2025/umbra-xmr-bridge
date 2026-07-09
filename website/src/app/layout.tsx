import type { Metadata, Viewport } from 'next';
import { Outfit, JetBrains_Mono } from 'next/font/google';
import '@/styles/globals.css';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MobileNav } from '@/components/layout/MobileNav';
import { ToastContainer } from '@/components/ui/Toast';
import { SmoothScroll } from '@/components/tikto/SmoothScroll';

// Tiktó display type
const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Umbra — Private Cross-Chain Bridge',
    template: '%s · Umbra',
  },
  description:
    'Bridge XMR to any chain privately. Non-custodial, no KYC. Support for BTC, ETH, TON, SOL, Arbitrum, Base, USDC, and USDT.',
  keywords: [
    'Monero',
    'XMR',
    'bridge',
    'swap',
    'non-custodial',
    'no KYC',
    'privacy',
    'Bitcoin',
    'Ethereum',
    'TON',
    'Solana',
    'cross-chain',
  ],
  authors: [{ name: 'Umbra' }],
  openGraph: {
    title: 'Umbra — Private Cross-Chain Bridge',
    description: 'Bridge XMR to any chain privately. Non-custodial, no KYC.',
    type: 'website',
    siteName: 'Umbra',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Umbra — Private Cross-Chain Bridge',
    description: 'Bridge XMR to any chain privately. Non-custodial, no KYC.',
  },
  robots: 'index, follow',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${outfit.variable} ${jetbrainsMono.variable}`}>
      <body className="tk min-h-screen bg-surface-deep text-ink-1 font-sans antialiased">
        <SmoothScroll>
          <div className="flex flex-col min-h-screen">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <MobileNav />
          </div>
        </SmoothScroll>
        <ToastContainer />
      </body>
    </html>
  );
}
