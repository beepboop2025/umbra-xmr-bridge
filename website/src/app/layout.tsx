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
  metadataBase: new URL('https://umbra-xmr.com'),
  title: {
    default: 'Umbra | Experimental cross-chain swap platform',
    template: '%s · Umbra',
  },
  description:
    'Experimental swap workflows for Monero and public-chain assets, with threshold-signing controls, signed receipts, and transparency-log tooling.',
  authors: [{ name: 'Umbra' }],
  openGraph: {
    url: '/',
    title: 'Umbra | Experimental cross-chain swap platform',
    description: 'Threshold-signing controls, signed receipts, and transparency-log tooling for cross-chain swap workflows.',
    type: 'website',
    siteName: 'Umbra',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Umbra | Experimental cross-chain swap platform',
    description: 'Threshold-signing controls, signed receipts, and transparency-log tooling for cross-chain swap workflows.',
  },
  robots: { index: true, follow: true },
};

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Umbra',
  url: 'https://umbra-xmr.com/',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  description:
    'Experimental cross-chain swap platform with threshold-signing controls, signed receipts, and transparency-log tooling.',
  codeRepository: 'https://github.com/beepboop2025/umbra-xmr-bridge',
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
        />
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
