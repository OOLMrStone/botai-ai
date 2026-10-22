import { BRAND } from '@/config/brand';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

interface WordmarkProps {
  className?: string;
  variant?: keyof typeof layout.wordmark.sizes;
}

// Отражение повторяет те же буквы, поэтому блик не меняет геометрию знака.
export function Wordmark({ className, variant = 'hero' }: WordmarkProps) {
  return (
    <span
      role="img"
      data-wordmark={variant}
      aria-label={BRAND.name}
      className={cn(layout.wordmark.root, layout.wordmark.sizes[variant], className)}
    >
      <span aria-hidden="true">{BRAND.prefix}</span>
      <span aria-hidden="true" data-reflection={BRAND.suffix} className={layout.wordmark.ai}>
        {BRAND.suffix}
      </span>
    </span>
  );
}
