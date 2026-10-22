import { ArrowUpRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DISABLED_ACTION_COPY } from '@/config/disabled-action';
import { layout } from '@/config/layout';
import { TASK_COPY } from '@/config/tasks';
import type { CatalogNumber, Task } from '@/lib/api/learning-types';
import { cn } from '@/lib/utils';

interface Props {
  number: CatalogNumber;
  tasks: Task[];
  disabled?: boolean;
  loading?: boolean;
  onOpen: () => void;
}

export function ExamNumberCard({ number, tasks, disabled, loading, onOpen }: Props) {
  const active = number.availableCount > 0;
  const solved = tasks.filter((task) => task.progressStatus === 'solved').length;

  return (
    <Button
      variant="ghost"
      size="card"
      type="button"
      data-exam-number={number.examNumber}
      disabled={!active || disabled}
      disabledReason={!active && !disabled ? DISABLED_ACTION_COPY.catalogEmpty : undefined}
      aria-busy={loading}
      className={cn(
        layout.tasks.card,
        layout.tasks.compactCard,
        active ? layout.tasks.activeCard : layout.tasks.disabledCard,
        layout.focusRing,
      )}
      onClick={onOpen}
    >
      <span className={layout.tasks.numberHeaderGrid}>
        <span className={layout.tasks.numberHeaderMeta}>
          <span className={layout.tasks.numberLabel}>
            {TASK_COPY.examNumberPrefix}
            {number.examNumber}
          </span>
          {active ? <ArrowUpRight className={layout.tasks.numberArrow} /> : null}
        </span>
        <span className={cn(layout.tasks.numberHeadingTitle, layout.tasks.numberTitleCompact)}>
          {number.title}
        </span>
        <span className={layout.tasks.compactMetricValue}>
          {loading
            ? TASK_COPY.catalog.opening
            : !active
              ? TASK_COPY.soon
              : solved
                ? TASK_COPY.catalog.solved(solved, number.availableCount)
                : TASK_COPY.catalog.available(number.availableCount)}
        </span>
      </span>
    </Button>
  );
}
