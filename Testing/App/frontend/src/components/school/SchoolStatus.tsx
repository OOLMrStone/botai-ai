import { SCHOOL_COPY as C, SCHOOL_STATUS_ICONS } from '@/config/school';
import { layout } from '@/config/layout';
import type { SchoolStatus as Status } from '@/lib/api/school-types';
import { cn } from '@/lib/utils';

export function SchoolStatus({ status, detail = false }: { status: Status; detail?: boolean }) {
  const Icon = SCHOOL_STATUS_ICONS[status];
  return (
    <span className={detail ? layout.school.stack : undefined} role={detail ? 'status' : undefined}>
      <span
        className={cn(
          layout.school.status,
          (status === 'failed' || status === 'expired') && layout.school.statusWarning,
        )}
      >
        <Icon className={layout.school.statusIcon} aria-hidden="true" />
        {C.statuses[status]}
      </span>
      {detail ? <span className={layout.school.hint}>{C.hints[status]}</span> : null}
    </span>
  );
}
