import { gridStudentRows } from '@/lib/grid-view';
import { Plus, ArrowRight } from 'lucide-react';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import { EXPERT_COPY as COPY } from '@/config/expert';
import { EXPERT_UI_COPY as UI } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { type GridUi, type GridWorkspace } from '@/hooks/use-grid-ui';

export function ExpertStudents({ workspace, ui }: { workspace: GridWorkspace; ui: GridUi }) {
  const styles = layout.expert;
  const students = gridStudentRows({ students: workspace.students, works: workspace.allWorks });

  return (
    <main className={styles.queue}>
      <div className={styles.queueIntro}>
        <ScreenHeading title={COPY.students} subtitle={UI.studentsSubtitle} variant="app" />
        <Button onClick={() => ui.setDialog('student')}>
          <Plus aria-hidden="true" />
          {COPY.addStudent}
        </Button>
      </div>
      <div className={styles.studentCards}>
        {students.map((student) => (
          <article className={styles.studentCard} key={student.id}>
            <div className={styles.studentIdentity}>
              <span className={styles.studentAvatar}>{student.initials}</span>
              <div className={styles.studentText}>
                <ScreenHeading title={student.name} as="h2" variant="task" />
                <span className={styles.caption}>{COPY.pendingTasks(student.pending)}</span>
              </div>
            </div>
            <dl className={styles.contacts}>
              <dt className={styles.contactLabel}>{COPY.studentId}</dt>
              <dd className={styles.contact}>{student.id}</dd>
              <dt className={styles.contactLabel}>{COPY.studentEmail}</dt>
              <dd className={styles.contact}>{student.email || COPY.noContact}</dd>
              <dt className={styles.contactLabel}>{COPY.studentContact}</dt>
              <dd className={styles.contact}>{student.contact || COPY.noContact}</dd>
            </dl>
            <Button
              variant="outline"
              disabled={!student.pending}
              onClick={() => ui.openStudentWorks(student.name)}
            >
              {student.pending ? UI.studentWorks : UI.noStudentWorks}
              <ArrowRight aria-hidden="true" />
            </Button>
          </article>
        ))}
      </div>
      {!students.length ? (
        <div className={styles.queueEmpty}>
          <ScreenHeading title={UI.studentsEmpty} as="h2" variant="task" />
          <p className={styles.queueEmptyText}>{UI.studentsEmptyHint}</p>
        </div>
      ) : null}
    </main>
  );
}
