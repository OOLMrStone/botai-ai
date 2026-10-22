'use client';

import { ExpertHeader } from '@/components/experimental/ExpertHeader';
import { ExpertQueue } from '@/components/experimental/ExpertQueue';
import { ReviewHeader } from '@/components/experimental/ReviewHeader';
import { ReviewVerdict } from '@/components/experimental/ReviewVerdict';
import { ReviewDialogs } from '@/components/experimental/ReviewDialogs';
import { ReviewSource } from '@/components/experimental/ReviewSource';
import { SolutionReview } from '@/components/experimental/SolutionReview';
import { ScreenTransition } from '@/components/onboarding/ScreenTransition';
import { layout } from '@/config/layout';
import { useExperimentalReview } from '@/hooks/use-experimental-review';

export function ExperimentalWorkspace() {
  const review = useExperimentalReview();
  const styles = layout.experimental;

  return (
    <div className={styles.root}>
      <ExpertHeader />
      {review.screen === 'queue' ? (
        <ExpertQueue onOpenStudent={review.openStudent} />
      ) : (
        <main className={styles.review}>
          <ReviewHeader onBack={review.openQueue} />
          <div className={styles.columns}>
            <div className={styles.document} data-experimental-document>
              <ScreenTransition>
                <div className={styles.paper}>
                  <SolutionReview
                    selectedId={review.selectedPointId}
                    onPointOpen={review.setPointOpen}
                    onDispute={review.toggleDispute}
                    disputedIds={review.disputedPointIds}
                    sourceAction={
                      <ReviewSource
                        photoUrl={review.photoUrl}
                        onOpen={() => review.setSourceOpen(true)}
                      />
                    }
                  />
                </div>
              </ScreenTransition>
            </div>
            <ReviewVerdict review={review} />
          </div>
        </main>
      )}
      <ReviewDialogs review={review} />
      <span role="status" aria-live="polite" className={layout.disabledAction.hiddenDescription}>
        {review.feedback}
      </span>
    </div>
  );
}
