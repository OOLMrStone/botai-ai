'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { StorefrontAction } from '@/components/storefront/StorefrontAction';
import { layout } from '@/config/layout';
import { STOREFRONT, STOREFRONT_COPY as COPY, STOREFRONT_NAV } from '@/config/storefront';
import type { User } from '@/lib/api/auth';
import { useStorefrontNavigation } from '@/hooks/use-storefront';

export function StorefrontNavigation({
  user = null,
  entryHref = STOREFRONT.start,
  entryLabel = COPY.check,
}: {
  user?: User | null;
  entryHref?: string;
  entryLabel?: string;
}) {
  const { menuOpen, toggleMenu, closeMenu, menuButton } = useStorefrontNavigation();
  const MenuIcon = menuOpen ? X : Menu;

  return (
    <header className={layout.storefront.navOuter}>
      <div className={layout.storefront.nav}>
        <Link href={STOREFRONT.home} aria-label={COPY.home} className={layout.storefront.brandLink}>
          <Image {...STOREFRONT.logo} alt="" className={layout.storefront.brandIcon} />
          <Wordmark variant="compact" />
        </Link>
        <nav className={layout.storefront.desktopLinks} aria-label={COPY.nav}>
          {STOREFRONT_NAV.map((item) => (
            <a key={item.href} href={item.href} className={layout.storefront.navLink}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className={layout.storefront.navActions}>
          <Link
            href={user ? STOREFRONT.account : STOREFRONT.login}
            className={layout.storefront.accountLink}
          >
            {user ? user.displayName || COPY.account : COPY.login}
          </Link>
          <StorefrontAction href={entryHref} tone="dark" className={layout.storefront.navCta}>
            {entryLabel}
          </StorefrontAction>
          <Button
            variant="ghost"
            size="icon-compact"
            ref={menuButton}
            type="button"
            className={layout.storefront.menuButton}
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls={STOREFRONT.mobileMenu}
            aria-label={menuOpen ? COPY.closeMenu : COPY.openMenu}
          >
            <MenuIcon className={layout.storefront.icon} aria-hidden />
          </Button>
        </div>
      </div>
      {menuOpen ? (
        <nav
          id={STOREFRONT.mobileMenu}
          className={layout.storefront.mobileMenu}
          aria-label={COPY.nav}
        >
          {STOREFRONT_NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={layout.storefront.navLink}
              onClick={closeMenu}
            >
              {item.label}
            </a>
          ))}
          <Link href={entryHref} className={layout.storefront.navLink} onClick={closeMenu}>
            {entryLabel}
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
