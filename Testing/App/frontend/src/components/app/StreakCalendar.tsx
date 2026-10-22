'use client';
import { Flame } from 'lucide-react';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';
import type { Stats } from '@/lib/api/stats';
export function StreakCalendar({ week, today }: { week: Stats['week']; today: string }) {
  return (
    <div className={layout.app.calendar.root}>
      {week.map((day) => (
        <div key={day.date} className={layout.app.calendar.day}>
          <span className={layout.typography.caption}>
            {new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(
              new Date(`${day.date}T12:00:00Z`),
            )}
          </span>
          <div
            className={cn(
              layout.app.calendar.circle,
              day.qualified ? layout.app.calendar.active : layout.app.calendar.idle,
              day.date === today && layout.app.calendar.today,
            )}
          >
            {day.qualified ? (
              <Flame className={layout.app.calendar.icon} />
            ) : (
              new Date(`${day.date}T12:00:00Z`).getUTCDate()
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
