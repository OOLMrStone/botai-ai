import Image from 'next/image';

import { layout } from '@/config/layout';
import { STOREFRONT } from '@/config/storefront';

export function OnboardingMascot() {
  return <Image {...STOREFRONT.mascot} alt="" loading="eager" className={layout.surface.mascot} />;
}
