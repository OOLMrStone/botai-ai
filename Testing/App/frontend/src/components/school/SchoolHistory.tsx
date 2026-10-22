import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { SchoolResult } from '@/components/school/SchoolResult';
import { SchoolStatus } from '@/components/school/SchoolStatus';
import { SCHOOL_COPY as C } from '@/config/school';
import { layout } from '@/config/layout';
import type { SchoolAssignment } from '@/lib/api/school-types';

export function SchoolHistory({ assignment }: { assignment: SchoolAssignment }) {
  const history = (assignment.history ?? []).filter(
    (item) => item.id !== assignment.submission?.id,
  );
  if (!history.length) return null;
  const styles = layout.school;
  return (
    <section className={styles.section}>
      <ScreenHeading title={C.history} variant="task" as="h2" />
      {history.map((submission, index) => (
        <details key={submission.id} className={styles.stack}>
          <summary className={styles.historySummary}>
            {C.historyAttempt(history.length - index)}
            <SchoolStatus status={submission.status} />
          </summary>
          <SchoolResult submission={submission} maxScore={assignment.maxScore} />
        </details>
      ))}
    </section>
  );
}
