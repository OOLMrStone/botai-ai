'use client';

import { Wrench, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { DEV_COPY, DEV_SCREENS } from '@/config/dev';
import { APP_ENV, IS_MOCK_API } from '@/config/env';
import { PLAN_IDS, PLANS } from '@/config/plans';
import { useDevTools } from '@/hooks/use-dev-tools';
import { cn } from '@/lib/utils';

// Инструмент разработчика: посмотреть, в какой мы сборке, войти тестовым
// аккаунтом, переключить тариф, сбросить состояние и прыгнуть на любой экран.
// В продовой сборке не рендерится и не грузится (см. DevToolsSlot).
export function DevTools() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={DEV_COPY.open}
        onClick={() => setOpen((value) => !value)}
        className="bg-foreground text-background fixed right-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex size-10 items-center justify-center rounded-full opacity-70 shadow-lg transition-opacity active:opacity-100"
      >
        {open ? <X className="size-4" /> : <Wrench className="size-4" />}
      </button>

      {open ? <DevPanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DevPanel({ onClose }: { onClose: () => void }) {
  const state = useDevTools(onClose);

  return (
    <div className="bg-background/95 border-border fixed inset-x-2 bottom-[calc(8rem+env(safe-area-inset-bottom))] z-50 max-h-[60svh] space-y-4 overflow-y-auto rounded-2xl border p-4 text-sm shadow-xl backdrop-blur">
      <Section title={DEV_COPY.envTitle}>
        <p className="text-muted-foreground">
          {APP_ENV} · {IS_MOCK_API ? DEV_COPY.apiMock : DEV_COPY.apiReal}
        </p>
      </Section>

      <Section title={DEV_COPY.accountTitle}>
        <p className="text-muted-foreground">{state.user?.email ?? DEV_COPY.accountAnonymous}</p>
        <div className="flex gap-2">
          {IS_MOCK_API ? (
            <Button
              size="compact"
              variant="outline"
              onClick={() => void state.handleLogin()}
              disabled={state.pending}
            >
              {DEV_COPY.login}
            </Button>
          ) : null}
          <Button
            size="compact"
            variant="ghost"
            onClick={() => void state.handleLogout()}
            disabled={!state.user || state.pending}
          >
            {DEV_COPY.logout}
          </Button>
        </div>
      </Section>

      {IS_MOCK_API ? (
        <Section title={DEV_COPY.planTitle}>
          <div className="flex gap-2">
            {PLAN_IDS.map((id) => (
              <Button
                key={id}
                size="compact"
                variant={id === state.plan ? 'default' : 'outline'}
                disabled={!state.user || state.pending}
                onClick={() => void state.handlePlan(id)}
              >
                {PLANS[id].label}
              </Button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={DEV_COPY.resetTitle}>
        <Button
          size="compact"
          variant="outline"
          onClick={state.handleReset}
          disabled={state.pending}
        >
          {DEV_COPY.resetAction}
        </Button>
      </Section>

      {IS_MOCK_API ? (
        <Section title={DEV_COPY.resetMockExamTitle}>
          <div>
            <Button
              size="compact"
              variant="outline"
              onClick={state.handleOpenMockExam}
              disabled={state.pending}
            >
              {DEV_COPY.openMockExamTask}
            </Button>
          </div>
          <Button
            size="compact"
            variant="outline"
            onClick={() => void state.handleResetMockExam()}
            disabled={state.pending}
          >
            {DEV_COPY.resetMockExamAction}
          </Button>
        </Section>
      ) : null}

      <Section title={DEV_COPY.screensTitle}>
        <div className="flex flex-wrap gap-1.5">
          {DEV_SCREENS.map((screen) => (
            <button
              key={screen.href}
              type="button"
              onClick={() => state.go(screen.href)}
              className={cn(
                'border-border text-muted-foreground rounded-md border px-2 py-1 text-xs',
                'hover:bg-muted transition-colors',
              )}
            >
              {screen.label}
            </button>
          ))}
        </div>
      </Section>

      {state.note ? <p className="text-muted-foreground text-xs">{state.note}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="font-semibold">{title}</p>
      {children}
    </div>
  );
}
