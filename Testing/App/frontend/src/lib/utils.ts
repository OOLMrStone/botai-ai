import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { UI_RADIUS_ROLES } from '@/config/layout';

const mergeClasses = extendTailwindMerge({
  extend: { theme: { radius: [...UI_RADIUS_ROLES] } },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}
