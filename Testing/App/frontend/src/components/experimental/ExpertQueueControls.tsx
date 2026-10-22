import { ChevronDown, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  EXPERIMENTAL_QUEUE,
  EXPERIMENTAL_WORKSPACE_COPY as COPY,
} from '@/config/experimental-workspace';
import { layout } from '@/config/layout';
import type { useExperimentalQueue } from '@/hooks/use-experimental-queue';
import { cn } from '@/lib/utils';

interface ExpertQueueControlsProps {
  queue: ReturnType<typeof useExperimentalQueue>;
}

export function ExpertQueueControls({ queue }: ExpertQueueControlsProps) {
  const styles = layout.experimental;

  return (
    <div className={styles.queueControls}>
      <div className={styles.queueSearch}>
        <Search className={styles.queueSearchIcon} aria-hidden="true" />
        <Input
          type="search"
          value={queue.query}
          onChange={(event) => queue.setQuery(event.target.value)}
          aria-label={COPY.queueSearch}
          placeholder={COPY.queueSearch}
          className={styles.queueSearchInput}
        />
      </div>
      <div className={styles.queueSortRoot}>
        <select
          value={queue.sort}
          onChange={(event) => queue.changeSort(event.target.value)}
          aria-label={COPY.queueSort}
          className={cn(layout.control.input, styles.queueSort)}
        >
          {EXPERIMENTAL_QUEUE.sortOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className={styles.queueSortIcon} aria-hidden="true" />
      </div>
    </div>
  );
}
