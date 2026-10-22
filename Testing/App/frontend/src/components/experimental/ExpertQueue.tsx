import { ArrowRight, ChevronRight } from 'lucide-react';
import { ExpertQueueControls } from '@/components/experimental/ExpertQueueControls';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import {
  EXPERIMENTAL_WORKSPACE as WORKSPACE,
  EXPERIMENTAL_WORKSPACE_COPY as COPY,
} from '@/config/experimental-workspace';
import { layout } from '@/config/layout';
import { useExperimentalQueue } from '@/hooks/use-experimental-queue';
import { cn } from '@/lib/utils';

interface ExpertQueueProps {
  onOpenStudent: (id: string) => void;
}

export function ExpertQueue({ onOpenStudent }: ExpertQueueProps) {
  const styles = layout.experimental;
  const queue = useExperimentalQueue(onOpenStudent);

  return (
    <main className={styles.queue}>
      <div className={styles.queueIntro}>
        <div className={styles.queueInfo}>
          <ScreenHeading title={COPY.queueTitle} subtitle={COPY.queueSubtitle} variant="app" />
        </div>
        <Button onClick={queue.startReview} className={styles.queueStart}>
          {COPY.queueStart}
          <ArrowRight className={styles.icon} aria-hidden="true" />
        </Button>
      </div>
      <div className={styles.stack}>
        <div className={styles.queueTabs}>
          <div className={styles.queueTab}>
            {COPY.queueTab}
            <span className={styles.count}>{WORKSPACE.pendingCount}</span>
          </div>
          <ExpertQueueControls queue={queue} />
        </div>
        <div className={styles.queueTable}>
          <div className={cn(styles.queueColumns, styles.queueGridColumns)} aria-hidden="true">
            {WORKSPACE.columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          {queue.students.map((student) => (
            <button
              key={student.id}
              type="button"
              className={cn(styles.studentRow, styles.queueGridColumns)}
              onClick={() => onOpenStudent(student.id)}
            >
              <span className={styles.studentIdentity}>
                <span className={styles.studentAvatar}>{student.initials}</span>
                <span className={styles.studentText}>
                  <span className={styles.studentName}>{student.name}</span>
                  <span className={styles.studentMobile}>
                    {COPY.tasks(student.tasks)} · {student.submittedAt}
                  </span>
                </span>
              </span>
              <span className={styles.studentCell}>{student.subject}</span>
              <span className={styles.studentTasks}>{COPY.tasks(student.tasks)}</span>
              <span className={styles.studentCell}>{student.submittedAt}</span>
              <span className={styles.studentEnd}>
                <span className={cn(styles.status, styles.studentStatus)}>
                  <span className={styles.statusDot} />
                  <span className={styles.studentStatusLabel}>{COPY.queueReady}</span>
                </span>
                <ChevronRight className={styles.icon} />
              </span>
            </button>
          ))}
          {queue.students.length === 0 ? (
            <div className={styles.queueEmpty} role="status">
              <ScreenHeading title={COPY.queueEmptyTitle} as="h2" variant="task" />
              <p className={styles.queueEmptyText}>{COPY.queueEmptyHint}</p>
              <Button variant="outline" onClick={queue.resetSearch}>
                {COPY.queueReset}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
