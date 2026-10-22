import dynamic from 'next/dynamic';

import { DEV_TOOLS_ENABLED } from '@/config/env';

// Панель едет отдельным чанком и подключается только вне прода: в продовой
// сборке DEV_TOOLS_ENABLED сложен в false, ветка не рендерится и чанк не грузится.
const DevTools = dynamic(() => import('@/components/dev/DevTools').then((m) => m.DevTools));

export function DevToolsSlot() {
  return DEV_TOOLS_ENABLED ? <DevTools /> : null;
}
