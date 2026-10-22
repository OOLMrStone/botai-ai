import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { layout } from '@/config/layout';

interface StorefrontActionProps {
  href: string;
  children: React.ReactNode;
  tone?: 'orange' | 'dark';
  className?: string;
}

const tones = {
  orange: 'storefront',
  dark: 'storefrontDark',
} as const;

export function StorefrontAction({
  href,
  children,
  tone = 'orange',
  className,
}: StorefrontActionProps) {
  return (
    <Button
      render={<Link href={href} />}
      nativeButton={false}
      variant={tones[tone]}
      size="default"
      className={cn(layout.storefront.action, className)}
    >
      {children}
      <ArrowUpRight className={layout.storefront.smallIcon} aria-hidden />
    </Button>
  );
}
