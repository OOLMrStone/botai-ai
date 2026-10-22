import { ChevronRight } from 'lucide-react';

import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { layout } from '@/config/layout';
import { TRAINING_REVIEW_COPY, TRAINING_REVIEW_STATES } from '@/config/training-review';
import { cn } from '@/lib/utils';

interface TrainingReviewProps {
  items: {
    id: string;
    index: number;
    examNumber: number;
    state: keyof typeof TRAINING_REVIEW_STATES;
  }[];
  completed: boolean;
  description: string;
  readyCount: number;
  gradedCount: number;
  onSelect: (index: number) => void;
}

export function TrainingReview({
  items,
  completed,
  description,
  readyCount,
  gradedCount,
  onSelect,
}: TrainingReviewProps) {
  return (
    <section className={cn(layout.training.card, layout.training.reviewCard)}>
      <div className={layout.training.reviewContent}>
        <ScreenHeading
          variant="app"
          title={completed ? TRAINING_REVIEW_COPY.result : TRAINING_REVIEW_COPY.title}
          subtitle={description}
        />
        <p className={layout.training.reviewStat}>
          {gradedCount
            ? TRAINING_REVIEW_COPY.checkedCount(gradedCount, items.length)
            : TRAINING_REVIEW_COPY.readyCount(readyCount, items.length)}
        </p>
        <div className={layout.training.reviewList}>
          {items.map(({ id, index, examNumber, state }) => {
            const { label, icon: Icon, className } = TRAINING_REVIEW_STATES[state];
            return (
              <button
                key={id}
                type="button"
                className={cn(layout.training.reviewTask, layout.focusRing)}
                onClick={() => onSelect(index)}
              >
                <span className={layout.training.reviewPosition}>{index + 1}</span>
                <span className={layout.training.reviewTaskText}>
                  <span className={layout.typography.controlTitle}>
                    {TRAINING_REVIEW_COPY.task(examNumber)}
                  </span>
                  <span className={cn(layout.training.reviewState, className)}>
                    <Icon className={layout.training.reviewStateIcon} aria-hidden="true" />
                    {label}
                  </span>
                </span>
                <ChevronRight className={layout.training.actionIcon} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
