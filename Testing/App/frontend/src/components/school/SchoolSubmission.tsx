import { ArrowUpRight } from 'lucide-react';
import { FileUploadButton } from '@/components/common/FileUploadButton';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Button } from '@/components/ui/button';
import { SchoolFiles } from '@/components/school/SchoolFiles';
import { SchoolStatus } from '@/components/school/SchoolStatus';
import { SchoolPendingFiles } from '@/components/school/SchoolPendingFiles';
import { INTEGRATION, LEARNING_COPY } from '@/config/integration';
import { SCHOOL_COPY as C } from '@/config/school';
import { layout } from '@/config/layout';
import type { SchoolAssignment } from '@/lib/api/school-types';
import { useSchoolSubmission } from '@/hooks/use-school-submission';
import { schoolCanRetry } from '@/lib/school';

export function SchoolSubmission({ assignment }: { assignment: SchoolAssignment }) {
  const actions = useSchoolSubmission(assignment);
  const styles = layout.school;
  const submission = assignment.submission;
  const incomplete = submission?.status === 'draft' && assignment.fixtureAttachmentIncomplete;
  const editable = (!submission || submission.status === 'draft') && !incomplete;
  return (
    <section className={styles.section} aria-busy={actions.busy}>
      <ScreenHeading title={C.solution} variant="task" as="h2" />
      {submission ? (
        <SchoolFiles submission={submission} actions={actions} editable={editable} />
      ) : null}
      {!submission?.images.length && !submission?.documents.length ? (
        <p className={styles.hint}>{C.emptySolution}</p>
      ) : null}
      {editable ? (
        <>
          <FileUploadButton
            label={LEARNING_COPY.photo}
            accept={INTEGRATION.solutionAccept}
            multiple
            disabled={actions.busy}
            onAdd={(files) => void actions.upload(files)}
          />
          <p className={styles.hint}>{LEARNING_COPY.photoHint}</p>
          {assignment.fixtureAvailable ? (
            <Button
              variant="outline"
              disabled={actions.busy}
              onClick={() => void actions.attachFixture()}
            >
              {C.attachFixture}
            </Button>
          ) : null}
          <SchoolPendingFiles actions={actions} />
          <div className={styles.actionBar}>
            <Button
              className={styles.primaryAction}
              disabled={Boolean(actions.sendDisabled)}
              disabledReason={actions.sendDisabled ?? undefined}
              onClick={() => void actions.send()}
            >
              {C.send}
              <ArrowUpRight aria-hidden="true" />
            </Button>
          </div>
        </>
      ) : incomplete ? (
        <>
          <p className={styles.hint}>{C.fixtureIncomplete}</p>
          <Button
            variant="outline"
            disabled={actions.busy}
            onClick={() => void actions.restartFixture()}
          >
            {C.restartFixture}
          </Button>
        </>
      ) : (
        <>
          <SchoolStatus status={submission.status} detail />
          {schoolCanRetry(submission) || assignment.canResubmit ? (
            <Button variant="outline" disabled={actions.busy} onClick={() => void actions.retry()}>
              {assignment.canResubmit ? C.newSolution : C.retrySubmission}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
