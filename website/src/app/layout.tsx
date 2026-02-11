import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import '@/styles/globals.css';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MobileNav } from '@/components/layout/MobileNav';
import { ToastContainer } from '@/components/ui/Toast';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'XMRBridge - Private Multi-Chain Bridge',
    template: '%s | XMRBridge',
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
  authors: [{ name: 'XMRBridge' }],
  openGraph: {
    title: 'XMRBridge - Private Multi-Chain Bridge',
    description: 'Bridge XMR to any chain privately. Non-custodial, no KYC.',
    type: 'website',
    siteName: 'XMRBridge',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'XMRBridge - Private Multi-Chain Bridge',
    description: 'Bridge XMR to any chain privately. Non-custodial, no KYC.',
  },
  robots: 'index, follow',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050810',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-surface-deep text-gray-100 font-sans antialiased">
        <div className="flex flex-col min-h-screen">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          <MobileNav />
        </div>
        <ToastContainer />
      </body>
    </html>
  );
}
