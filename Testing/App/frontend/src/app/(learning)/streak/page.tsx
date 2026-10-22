'use client';

import { Check, Flame } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { ScreenTransition } from '@/components/onboarding/ScreenTransition';
import { layout } from '@/config/layout';
import { COPY, ROUTES } from '@/config/onboarding-steps';
import { cn } from '@/lib/utils';

const STREAK = 1;
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const VISIBLE_DAYS = 5;

// Первый день полоски - сегодня, дальше - следующие дни недели.
function buildWeek() {
  const today = new Date().getDay();
  return Array.from({ length: VISIBLE_DAYS }, (_, i) => ({
    label: WEEKDAYS[(today + i) % WEEKDAYS.length],
    active: i === 0,
  }));
}

// Награда после урока: streak «1 день в ударе», затем к сохранению прогресса.
export default function StreakPage() {
  const router = useRouter();
  const week = buildWeek();

  return (
    <ScreenTransition>
      <ScreenShell
        center
        footer={
          <Button
            className={layout.cta}
            size="default"
            onClick={() => router.push(ROUTES.saveProgress)}
          >
            {COPY.streak.action}
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-2">
          <Flame className="size-20 text-amber-500" strokeWidth={1.5} />
          <span className={layout.streakCelebration.score}>{STREAK}</span>
          <span className={layout.streakCelebration.unit}>{COPY.streak.unit}</span>
        </div>

        <div className={layout.surface.streakSummary}>
          <div className="flex justify-between">
            {week.map((day, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <span
                  className={cn(
                    'text-xs font-semibold',
                    day.active ? 'text-amber-500' : 'text-muted-foreground',
                  )}
                >
                  {day.label}
                </span>
                <span
                  className={cn(
                    layout.surface.streakDay,
                    day.active ? 'bg-amber-500 text-white' : 'bg-muted',
                  )}
                >
                  {day.active ? <Check className="size-4" strokeWidth={3} /> : null}
                </span>
              </div>
            ))}
          </div>

          <div className="border-border border-t pt-3">
            <p className="text-muted-foreground text-center text-sm text-balance whitespace-pre-line">
              {COPY.streak.hint}
            </p>
          </div>
        </div>
      </ScreenShell>
    </ScreenTransition>
  );
}
