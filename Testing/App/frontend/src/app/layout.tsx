import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import { BRAND } from '@/config/brand';

import './globals.css';
import 'katex/dist/katex.min.css';

const productFont = localFont({
  variable: '--font-product',
  src: '../assets/fonts/onest-variable.ttf',
  weight: '100 900',
  preload: true,
  display: 'swap',
});

export const metadata: Metadata = BRAND.metadata;

// Мобайл-фёрст: подгоняем под device-width, viewport-fit=cover открывает
// safe-area-insets (чёлка, домашняя полоса) - экран не лезет под аппаратные зоны.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${productFont.variable} h-full antialiased`}>
      <body className="bg-muted/30">{children}</body>
    </html>
  );
}
