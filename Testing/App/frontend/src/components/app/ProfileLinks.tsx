'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { layout } from '@/config/layout';
import { PROFILE_LINKS } from '@/config/profile';
import { BILLING_PROFILE_LINK } from '@/config/billing';
import { cn } from '@/lib/utils';

export function ProfileLinks({ billingEnabled }: { billingEnabled: boolean }) {
  const links = billingEnabled ? [BILLING_PROFILE_LINK, ...PROFILE_LINKS] : PROFILE_LINKS;
  return (
    <div className={layout.app.profile.links}>
      {links.map(({ href, title, hint, icon: Icon }) => (
        <Link key={href} href={href} className={cn(layout.app.profile.settings, layout.focusRing)}>
          <Icon className={layout.app.profile.settingsIcon} aria-hidden="true" />
          <span className={layout.app.profile.linkText}>
            <span className={layout.typography.controlTitle}>{title}</span>
            <span className={layout.typography.caption}>{hint}</span>
          </span>
          <ChevronRight className={layout.app.profile.settingsIcon} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
