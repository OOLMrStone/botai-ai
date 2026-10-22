'use client';

import { ArrowUpLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Wordmark } from '@/components/onboarding/Wordmark';

import { layout } from '@/config/layout';
import { APP_TABS, LEARNING_COPY } from '@/config/navigation';
import { ROUTES } from '@/config/onboarding-steps';
import { cn } from '@/lib/utils';

// Одни разделы: нижнее меню на телефоне, боковая навигация на компьютере.
export function AppNavigation() {
  const pathname = usePathname();

  return (
    <nav className={layout.bottomNav.root} aria-label={LEARNING_COPY.navigation}>
      <div className={layout.bottomNav.brand}>
        <Link
          href={ROUTES.storefront}
          className={layout.bottomNav.brandLink}
          aria-label={LEARNING_COPY.storefront}
        >
          <Wordmark variant="navigation" />
        </Link>
        <p className={layout.bottomNav.caption}>{LEARNING_COPY.course}</p>
      </div>
      {APP_TABS.map((tab) => {
        const { href, label, icon: Icon } = tab;
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              layout.bottomNav.item,
              active ? layout.bottomNav.active : layout.bottomNav.idle,
            )}
          >
            <Icon className={layout.bottomNav.icon} />
            {label}
          </Link>
        );
      })}
      <Link href={ROUTES.storefront} className={cn(layout.bottomNav.footer, layout.focusRing)}>
        <ArrowUpLeft className={layout.learning.icon} />
        {LEARNING_COPY.storefront}
      </Link>
    </nav>
  );
}
