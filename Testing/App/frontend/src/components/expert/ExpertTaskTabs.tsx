import { TaskStatusScrubber } from '@/components/tasks/TaskStatusScrubber';
import type { ExpertTask } from '@/config/expert';
import { EXPERT_TASK_NAVIGATION as COPY } from '@/config/expert-task-navigation';
import { layout } from '@/config/layout';
import { useExpertTaskTabs } from '@/hooks/use-expert-task-tabs';
import { cn } from '@/lib/utils';

export function ExpertTaskTabs({
  tasks,
  currentTaskId,
  onSelect,
}: {
  tasks: ExpertTask[];
  currentTaskId: string;
  onSelect: (id: string) => void;
}) {
  const {
    containerRef,
    pillsRef,
    compact,
    items,
    index,
    current,
    taskIds,
    statuses,
    valueLabels,
    selectIndex,
  } = useExpertTaskTabs(tasks, currentTaskId, onSelect);
  const styles = layout.expertTaskNavigation;

  return (
    <div ref={containerRef} className={styles.root}>
      <div
        className={compact ? styles.measuringViewport : styles.pillsViewport}
        inert={compact}
        aria-hidden={compact || undefined}
      >
        <nav ref={pillsRef} className={styles.pills} aria-label={COPY.label}>
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={cn(
                layout.expert.taskTab,
                styles.pill,
                item.id === currentTaskId && styles.pillActive,
                styles.tones[item.status],
              )}
              onClick={() => onSelect(item.id)}
              aria-label={item.ariaLabel}
              aria-current={item.id === currentTaskId ? 'page' : undefined}
            >
              {item.label}
              {item.score ? <span className={styles.pillScore}>{item.score}</span> : null}
            </button>
          ))}
        </nav>
      </div>
      {compact && current ? (
        <div className={styles.scrubber}>
          <TaskStatusScrubber
            taskIds={taskIds}
            answeredTaskIds={[]}
            statuses={statuses}
            valueLabels={valueLabels}
            statusStyles={styles.scrubberStatusStyles}
            selection="outline"
            label={COPY.label}
            currentIndex={index}
            reviewActive={false}
            onSelect={selectIndex}
          />
        </div>
      ) : null}
    </div>
  );
}
