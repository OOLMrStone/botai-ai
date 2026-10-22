'use client';

import { useState } from 'react';

export function useExpertArtifact(url: string | null) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  return { available: Boolean(url && url !== failedUrl), fail: () => setFailedUrl(url) };
}
