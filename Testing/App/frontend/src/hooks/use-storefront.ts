'use client';

import { useEffect, useRef } from 'react';

import { useStorefrontStore } from '@/stores/storefront-store';

export function useStorefrontNavigation() {
  const menuOpen = useStorefrontStore((state) => state.menuOpen);
  const toggleMenu = useStorefrontStore((state) => state.toggleMenu);
  const closeMenu = useStorefrontStore((state) => state.closeMenu);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      closeMenu();
      menuButton.current?.focus();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen, closeMenu]);

  return { menuOpen, toggleMenu, closeMenu, menuButton };
}
