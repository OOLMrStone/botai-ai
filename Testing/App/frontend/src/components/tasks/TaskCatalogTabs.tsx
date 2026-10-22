import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { TASK_COPY } from '@/config/tasks';
import type { TasksView } from '@/stores/tasks-store';

interface Props {
  view: TasksView;
  onChange: (view: TasksView) => void;
}

export function TaskCatalogTabs({ view, onChange }: Props) {
  const activeIndex = TASK_COPY.views.findIndex(({ id }) => id === view);

  return (
    <div className={layout.tasks.tabs}>
      <span
        aria-hidden="true"
        className={layout.tasks.tabsIndicator}
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      <span
        aria-hidden="true"
        className={layout.tasks.tabsActiveLabels}
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      >
        <span
          className={layout.tasks.tabsActiveLabelsTrack}
          style={{ transform: `translateX(-${activeIndex * (100 / 3)}%)` }}
        >
          {TASK_COPY.views.map((item) => (
            <span key={item.id} className={layout.tasks.tabActiveLabel}>
              {item.label}
            </span>
          ))}
        </span>
      </span>
      {TASK_COPY.views.map((item) => (
        <Button
          key={item.id}
          variant="ghost"
          size="segment"
          aria-pressed={view === item.id}
          className={layout.tasks.tabButton}
          onClick={() => onChange(item.id)}
        >
          <span className={layout.tasks.tabLabel}>{item.label}</span>
        </Button>
      ))}
    </div>
  );
}
