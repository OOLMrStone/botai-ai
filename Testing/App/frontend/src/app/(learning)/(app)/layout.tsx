import { AppNavigation } from '@/components/app/AppNavigation';
import { layout } from '@/config/layout';

import { AppGuard } from './AppGuard';

// Оболочка раздела после логина: контент под гардом сессии + нижний таб-бар.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={layout.learning.app}>
      <main className={layout.learning.main}>
        <AppGuard>{children}</AppGuard>
      </main>
      <AppNavigation />
    </div>
  );
}
