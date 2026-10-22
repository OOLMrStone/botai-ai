import type { Metadata } from 'next';

import { Storefront } from '@/components/storefront/Storefront';
import { STOREFRONT } from '@/config/storefront';

export const metadata: Metadata = STOREFRONT.metadata;

export default function Home() {
  return <Storefront />;
}
