import { Sparkles } from 'lucide-react';

import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

interface MascotPlaceholderProps {
  className?: string;
  size?: keyof typeof layout.mascotPlaceholder.sizes;
}

export function MascotPlaceholder({ className, size = 'lg' }: MascotPlaceholderProps) {
  return (
    <div
      className={cn(layout.mascotPlaceholder.root, layout.mascotPlaceholder.sizes[size], className)}
      aria-hidden="true"
    >
      <Sparkles className={layout.mascotPlaceholder.icon} />
    </div>
  );
}
