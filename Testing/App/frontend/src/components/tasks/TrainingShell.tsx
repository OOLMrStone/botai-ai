'use client';
import Image from 'next/image';
import { X, CheckCheck, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { TaskStatusScrubber } from '@/components/tasks/TaskStatusScrubber';
import { TrainingControls } from '@/components/tasks/TrainingControls';
import { TrainingReview } from '@/components/tasks/TrainingReview';
import { TrainingTaskCard } from '@/components/tasks/TrainingTaskCard';
import { SubmissionDocuments } from '@/components/tasks/SubmissionDocuments';
import { AttemptFeedback } from '@/components/tasks/AttemptFeedback';
import { ErrorNote } from '@/components/common/ErrorNote';
import { MockExamAttachments } from '@/components/mock-exams/MockExamAttachments';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { TASK_COPY, TASK_CONTENT } from '@/config/tasks';
import { solutionBlocks } from '@/lib/task-content';
import { LEARNING_COPY as C, INTEGRATION } from '@/config/integration';
import { useTrainingShell } from '@/hooks/use-training-shell';
import { itemLocked } from '@/lib/attempt';
import { cn } from '@/lib/utils';
import { TRAINING_REVIEW_COPY } from '@/config/training-review';
export function TrainingShell({ attemptId }: { attemptId: string }) {
  const training = useTrainingShell(attemptId);
  const { attempt, item } = training;
  if (!attempt)
    return (
      <div className={layout.training.shell}>
        <div className={layout.training.cardArea}>
          {training.error ? (
            <ErrorNote message={training.error} onRetry={() => void training.retry()} />
          ) : (
            <p className={layout.typography.description}>{C.loading}</p>
          )}
        </div>
      </div>
    );
  const locked = item ? itemLocked(item) : false;
  const solution = item ? training.solutions[item.id] : undefined;
  return (
    <div className={cn(layout.training.shell, layout.viewport.width)}>
      <header className={layout.training.header}>
        <div className={layout.training.headerRow}>
          <Button
            variant="ghost"
            size="icon-compact"
            className={layout.training.closeButton}
            aria-label={TASK_COPY.training.exit}
            disabled={training.busy}
            onClick={() => void training.exit()}
          >
            <X className={layout.training.actionIcon} />
          </Button>
          <div className={layout.training.scrubber}>
            <TaskStatusScrubber
              taskIds={attempt.items.map((item) => item.id)}
              answeredTaskIds={training.answeredTaskIds}
              statuses={training.statuses}
              currentIndex={Math.min(training.currentIndex, attempt.items.length - 1)}
              reviewActive={training.review}
              onSelect={(index) => void training.select(index)}
              onReview={() => void training.select(training.reviewIndex)}
            />
          </div>
        </div>
      </header>
      <div className={layout.integration.summary}>
        <span className={layout.integration.summaryLeading}>
          {training.activity.visible ? (
            <span
              className={layout.integration.timer}
              title={training.activity.description}
              aria-label={`${training.activity.description}: ${training.activity.label}`}
            >
              <Clock aria-hidden="true" className={layout.integration.timerIcon} />
              {training.activity.label}
            </span>
          ) : null}
        </span>
        <span className={layout.integration.summaryStatus}>
          {training.busy ? C.saving : training.unsaved ? C.unsaved : C.saved}
        </span>
        <span className={layout.integration.summaryPosition}>
          {training.review
            ? TRAINING_REVIEW_COPY.overview
            : TRAINING_REVIEW_COPY.position(training.currentIndex + 1, attempt.items.length)}
        </span>
      </div>
      {training.error ? (
        <ErrorNote
          message={training.error}
          retryLabel={training.conflict ? C.reload : C.retry}
          onRetry={() =>
            void (training.exitError
              ? training.exit()
              : training.conflict
                ? training.reload()
                : training.retry())
          }
        />
      ) : null}
      {training.revealError ? <ErrorNote message={training.revealError} /> : null}
      <main className={layout.training.content}>
        <div className={cn(layout.training.cardArea, layout.training.contentCardArea)}>
          {training.review ? (
            <TrainingReview
              items={training.reviewItems}
              completed={training.completed}
              description={training.reviewDescription}
              readyCount={training.readyCount}
              gradedCount={attempt.summary.graded}
              onSelect={(index) => void training.select(index)}
            />
          ) : item ? (
            <TrainingTaskCard
              allowScrollChain
              key={item.id}
              task={item.task}
              drawingKey={item.id}
              isFavourite={item.task.isFavourite}
              position={training.currentIndex + 1}
              status={training.statuses[item.id]}
              locked={locked || training.revealBusy}
              solutionRevealed={training.revealed.includes(item.id)}
              canReveal={Boolean(
                item.result?.isGraded ||
                item.submission?.result?.isGraded ||
                (item.task.part === 2 && item.task.gradingCapability === 'unsupported'),
              )}
              revealBusy={training.busy}
              revealLabel={
                item.task.part === 2 && item.task.gradingCapability === 'unsupported'
                  ? TASK_CONTENT.selfReview
                  : undefined
              }
              solution={solution ? solutionBlocks(solution) : []}
              onToggleSolution={() => void training.toggleSolution(item.id)}
            />
          ) : null}
        </div>
        {item && !training.review ? (
          <>
            {item.task.isDemo ? <p className={layout.integration.notice}>{C.demo}</p> : null}
            {training.photoNotice ? (
              <p className={layout.integration.notice}>{training.photoNotice}</p>
            ) : null}
            {item.task.responseType === 'photo' && !locked ? (
              <p className={layout.integration.notice}>{C.photoHint}</p>
            ) : null}
            <SubmissionDocuments
              documents={item.submission?.documents ?? []}
              canRemove={!locked && !training.busy && item.submission?.status === 'draft'}
              onRemove={(documentId) =>
                item.submission && void training.removeDocument(item.submission.id, documentId)
              }
            />
            {item.submission?.images.length ? (
              <div className={layout.integration.photos}>
                {item.submission.images.map((image) => (
                  <div key={image.id} className={layout.integration.photo}>
                    <a href={image.previewUrl} target="_blank" rel="noreferrer">
                      <Image
                        width={80}
                        height={80}
                        src={image.previewUrl}
                        alt={image.fileName}
                        className={layout.integration.preview}
                      />
                    </a>
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      aria-label={image.sourceDocumentId ? C.removeDocument : C.removePhoto}
                      disabled={locked || training.busy || item.submission?.status !== 'draft'}
                      disabledReason={training.photoDisabledReason}
                      onClick={() => void training.removeImage(item.submission!.id, image.id)}
                    >
                      <X className={layout.training.actionIcon} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <AttemptFeedback
              scrollWithContent
              item={item}
              busy={training.busy}
              canReviewPhoto={training.canReviewPhoto}
              onCancel={() => item.submission && void training.cancel(item.submission.id)}
              onRetry={() => void training.retrySubmission(item.id)}
            />
          </>
        ) : null}
      </main>
      <footer className={cn(layout.training.controls, layout.training.controlsRow)}>
        {training.review || item?.task.responseType === 'short' ? (
          <TrainingControls
            session={{
              id: attempt.id,
              taskIds: attempt.items.map((item) => item.id),
              currentIndex: training.currentIndex,
              answers: Object.fromEntries(
                attempt.items.map((item) => [item.id, training.answers[item.id] ?? item.answer]),
              ),
              statuses: training.statuses,
              revealedSolutions: training.revealed,
              source: 'catalog',
            }}
            taskId={item?.id}
            taskCount={attempt.items.length}
            review={training.review}
            reviewIndex={training.reviewIndex}
            status={item ? training.statuses[item.id] : 'unverified'}
            unverified={training.readyCount > 0}
            checkDisabledReason={training.checkDisabledReason}
            allCorrect={attempt.status === 'completed'}
            busy={training.busy}
            editingBusy={training.editingBusy}
            locked={locked}
            onSelect={(index) => void training.select(index)}
            onAnswer={training.setAnswer}
            onCheck={() => void training.check()}
            onContinue={() => void training.exit()}
          />
        ) : item ? (
          <>
            <Button
              variant="outline"
              size="icon"
              className={layout.training.controlButton}
              aria-label={TASK_COPY.training.previous}
              disabled={training.currentIndex === 0 || training.busy}
              onClick={() => void training.select(training.currentIndex - 1)}
            >
              <ChevronLeft />
            </Button>
            <MockExamAttachments
              onAdd={(files) => void training.upload(item.id, files)}
              onRequestAccess={training.requestPhotoAccess}
              disabledReason={training.photoDisabledReason}
              disabled={
                locked ||
                training.busy ||
                Boolean(item.submission && item.submission.status !== 'draft')
              }
              label={training.busy ? C.uploading : C.photo}
              accept={INTEGRATION.solutionAccept}
            />
            <Button
              variant="outline"
              size="icon"
              className={layout.training.controlButton}
              aria-label={TASK_COPY.training.next}
              disabled={training.busy}
              onClick={() => void training.select(training.currentIndex + 1)}
            >
              {training.currentIndex === attempt.items.length - 1 ? (
                <CheckCheck />
              ) : (
                <ChevronRight />
              )}
            </Button>
          </>
        ) : null}
      </footer>
    </div>
  );
}
