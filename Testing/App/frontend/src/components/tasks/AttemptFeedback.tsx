import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ATTEMPT_FEEDBACK_COPY } from '@/config/attempt-feedback';
import { LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import type { AttemptItem } from '@/lib/api/learning-types';
import { attemptFeedback, type AttemptFeedbackView } from '@/lib/attempt-feedback';
import { cn } from '@/lib/utils';

export function AttemptFeedback({
  item,
  busy,
  canReviewPhoto,
  onCancel,
  onRetry,
  scrollWithContent = false,
}: {
  item: AttemptItem;
  busy: boolean;
  canReviewPhoto: boolean;
  onCancel: () => void;
  onRetry: () => void;
  scrollWithContent?: boolean;
}) {
  const feedback = attemptFeedback(item, canReviewPhoto);
  if (!feedback) return null;

  return (
    <section
      className={cn(
        layout.integration.feedback,
        scrollWithContent && layout.integration.feedbackFlow,
      )}
    >
      {feedback.hasDetails ? (
        <details key={item.id} className={layout.integration.feedbackDetails}>
          <summary className={layout.integration.feedbackSummary}>
            <FeedbackStatus feedback={feedback} />
            <span className={layout.integration.feedbackDisclosure}>
              {LEARNING_COPY.feedback}
              <ChevronDown className={layout.integration.feedbackChevron} />
            </span>
          </summary>
          <div className={layout.integration.feedbackBody}>
            {feedback.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {feedback.errors.map((error) => (
              <div key={error.id} className={layout.integration.feedbackError}>
                {error.description ? (
                  <p className={layout.integration.feedbackErrorTitle}>{error.description}</p>
                ) : null}
                {error.where ? <p>{ATTEMPT_FEEDBACK_COPY.where(error.where)}</p> : null}
                {error.correction ? (
                  <p>{ATTEMPT_FEEDBACK_COPY.correction(error.correction)}</p>
                ) : null}
                {error.advice ? <p>{error.advice}</p> : null}
              </div>
            ))}
          </div>
        </details>
      ) : (
        <FeedbackStatus feedback={feedback} />
      )}
      {feedback.isDemo ? (
        <p className={layout.typography.caption}>{LEARNING_COPY.demoResult}</p>
      ) : null}
      {feedback.canCancel || feedback.canRetry ? (
        <div className={layout.integration.feedbackActions}>
          {feedback.canCancel ? (
            <Button variant="outline" size="compact" disabled={busy} onClick={onCancel}>
              {feedback.cancelLabel}
            </Button>
          ) : null}
          {feedback.canRetry ? (
            <Button variant="outline" size="compact" disabled={busy} onClick={onRetry}>
              {feedback.retryLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FeedbackStatus({ feedback }: { feedback: AttemptFeedbackView }) {
  const Icon = feedback.icon;

  return (
    <span className={cn(layout.integration.feedbackStatus, feedback.tone)} role="status">
      <Icon className={layout.integration.feedbackIcon} aria-hidden="true" />
      <span>{feedback.label}</span>
    </span>
  );
}
