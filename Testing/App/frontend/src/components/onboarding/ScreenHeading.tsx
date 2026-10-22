import type { ReactNode } from 'react';

import { BrandText } from '@/components/onboarding/BrandText';

import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

interface ScreenHeadingProps {
  title: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  subtitle?: string;
  variant?: keyof typeof layout.heading.variants;
}

// Вкладкам нужна компактная иерархия, даже когда экран достаточно высокий для hero.
export function ScreenHeading({
  title,
  subtitle,
  variant = 'screen',
  as: Heading = 'h1',
}: ScreenHeadingProps) {
  const typography = layout.heading.variants[variant];

  return (
    <div className={layout.heading.root}>
      <Heading tabIndex={-1} className={cn(layout.heading.title, typography.title)}>
        {typeof title === 'string' ? <BrandText text={title} /> : title}
      </Heading>
      {subtitle ? (
        <p className={cn(layout.heading.subtitle, typography.subtitle)}>
          <BrandText text={subtitle} />
        </p>
      ) : null}
    </div>
  );
}
