import type { MetadataRoute } from 'next';

import { APP_MANIFEST } from '@/config/app-manifest';

export default function manifest(): MetadataRoute.Manifest {
  return APP_MANIFEST;
}
