import { ArrowRight, RefreshCw } from 'lucide-react';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import { SchoolStatus } from '@/components/school/SchoolStatus';
import { SCHOOL, SCHOOL_COPY as C } from '@/config/school';
import { layout } from '@/config/layout';
import type { SchoolWorkspace } from '@/hooks/use-school-workspace';
import { cn } from '@/lib/utils';

export function SchoolAssignments({ workspace }: { workspace: SchoolWorkspace }) {
  const styles = layout.school;
  return (
    <>
      <div className={styles.row}>
        <div className={styles.heading}>
          <ScreenHeading title={C.title} subtitle={C.description} variant="app" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={C.refresh}
          disabled={workspace.busy}
          onClick={() => void workspace.refresh()}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      <nav className={styles.filters} aria-label={C.filter}>
        <Button
          variant="ghost"
          size="compact"
          aria-pressed={workspace.filter === SCHOOL.allNumbers}
          className={cn(
            styles.filter,
            workspace.filter === SCHOOL.allNumbers && styles.filterActive,
          )}
          onClick={() => workspace.setFilter(SCHOOL.allNumbers)}
        >
          {C.all}
        </Button>
        {workspace.session?.taskNumbers.map((number) => (
          <Button
            key={number}
            variant="ghost"
            size="compact"
            aria-pressed={workspace.filter === number}
            className={cn(styles.filter, workspace.filter === number && styles.filterActive)}
            onClick={() => workspace.setFilter(number)}
          >
            {C.number(number)}
          </Button>
        ))}
      </nav>
      {workspace.visibleAssignments.length ? (
        <div className={styles.list}>
          {workspace.visibleAssignments.map((assignment) => (
            <Button
              key={assignment.id}
              variant="outline"
              size="card"
              className={styles.assignment}
              disabled={workspace.busy}
              onClick={() => void workspace.open(assignment.id)}
            >
              <span className={styles.assignmentHeading}>
                <span className={styles.number}>{C.number(assignment.taskNumber)}</span>
                <span className={styles.title}>{assignment.title}</span>
                {(workspace.session?.schools.length ?? 0) > 1 ? (
                  <span className={styles.hint}>{assignment.school.name}</span>
                ) : null}
              </span>
              <span className={styles.row}>
                <SchoolStatus status={assignment.status} />
                <ArrowRight aria-hidden="true" />
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <ScreenHeading
          title={workspace.assignments.length ? C.emptyFilter : C.empty}
          subtitle={workspace.assignments.length ? C.emptyFilterHint : C.emptyHint}
          variant="task"
        />
      )}
    </>
  );
}
