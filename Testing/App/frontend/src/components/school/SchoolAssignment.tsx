import { ArrowLeft } from 'lucide-react';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { TaskBlockRenderer } from '@/components/tasks/TaskBlockRenderer';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { SchoolSubmission } from '@/components/school/SchoolSubmission';
import { SchoolHistory } from '@/components/school/SchoolHistory';
import { SchoolResult } from '@/components/school/SchoolResult';
import { Button } from '@/components/ui/button';
import { SCHOOL_COPY as C } from '@/config/school';
import { layout } from '@/config/layout';
import type { SchoolAssignment as Assignment } from '@/lib/api/school-types';

export function SchoolAssignment({
  assignment,
  busy,
  onBack,
  showSchool,
}: {
  assignment: Assignment;
  busy: boolean;
  onBack: () => void;
  showSchool: boolean;
}) {
  const styles = layout.school;
  return (
    <>
      <div className={styles.taskHeader}>
        <Button variant="outline" size="icon" aria-label={C.back} disabled={busy} onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className={styles.taskHeading}>
          <p className={styles.number}>{C.number(assignment.taskNumber)}</p>
          <ScreenHeading title={assignment.title} variant="app" />
          {showSchool ? <p className={styles.hint}>{assignment.school.name}</p> : null}
        </div>
      </div>
      {assignment.submission?.status === 'returned' ? (
        <SchoolResult submission={assignment.submission} maxScore={assignment.maxScore} />
      ) : null}
      <div className={styles.taskBody}>
        <section className={styles.section}>
          <ScreenHeading title={C.condition} variant="task" as="h2" />
          <div className={styles.statement}>
            {assignment.task.content.length ? (
              <TaskBlockRenderer blocks={assignment.task.content} />
            ) : (
              <ExpertRichText value={assignment.task.statement} />
            )}
          </div>
        </section>
        <SchoolSubmission key={assignment.id} assignment={assignment} />
      </div>
      <SchoolHistory assignment={assignment} />
    </>
  );
}
