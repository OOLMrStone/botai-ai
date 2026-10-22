import type { MetadataRoute } from 'next';

import { BRAND } from '@/config/brand';
import { ROUTES } from '@/config/onboarding-steps';

const backgroundColor = '#fff5d4';

export const APP_MANIFEST: MetadataRoute.Manifest = {
  id: ROUTES.storefront,
  name: BRAND.name,
  short_name: BRAND.name,
  description: BRAND.metadata.description,
  lang: 'ru',
  start_url: ROUTES.studentEntry,
  scope: ROUTES.storefront,
  display: 'standalone',
  background_color: backgroundColor,
  theme_color: backgroundColor,
  icons: [
    { src: '/icons/site-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/site-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: '/icons/site-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};
