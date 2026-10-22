import { ArrowLeft } from 'lucide-react';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import {
  EXPERIMENTAL_WORKSPACE as WORKSPACE,
  EXPERIMENTAL_WORKSPACE_COPY as COPY,
} from '@/config/experimental-workspace';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export function ReviewHeader({ onBack }: { onBack: () => void }) {
  const styles = layout.experimental;

  return (
    <div className={styles.reviewHeader}>
      <div className={styles.breadcrumb}>
        <Button size="icon-compact" variant="outline" onClick={onBack} aria-label={COPY.back}>
          <ArrowLeft />
        </Button>
      </div>
      <div className={styles.reviewIdentity}>
        <div className={styles.reviewName}>
          <span className={styles.studentAvatar}>{WORKSPACE.student.initials}</span>
          <div className={styles.reviewMetadata}>
            <ScreenHeading title={WORKSPACE.student.name} variant="app" />
            <p className={styles.caption}>{COPY.workDescription}</p>
          </div>
        </div>
        <div className={styles.taskTabs} aria-label={COPY.workDescription}>
          {WORKSPACE.taskTabs.map((task) => (
            <button
              key={task.id}
              type="button"
              className={cn(styles.taskTab, task.active && styles.taskActive)}
              aria-current={task.active ? 'page' : undefined}
            >
              {task.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
