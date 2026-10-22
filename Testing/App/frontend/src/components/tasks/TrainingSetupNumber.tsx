import { Check, ChevronDown, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import { TASK_COPY } from '@/config/tasks';
import type { TrainingSelection } from '@/lib/api/learning-types';
import type { TrainingNumberOption } from '@/lib/training-setup';
import { cn } from '@/lib/utils';

interface TrainingSetupNumberProps {
  number: TrainingNumberOption;
  selection: TrainingSelection;
  disabled: boolean;
  onRemove?: () => void;
  onCountChange: (count: number) => void;
  onTopicChange: (topicId?: string) => void;
}

export function TrainingSetupNumber({
  number,
  selection,
  disabled,
  onRemove,
  onCountChange,
  onTopicChange,
}: TrainingSetupNumberProps) {
  return (
    <section className={layout.trainingSetup.selection}>
      <div className={layout.trainingSetup.selectionHeading}>
        <p className={layout.trainingSetup.selectionTitle}>
          {TASK_COPY.setup.exam(number.examNumber, number.title)}
        </p>
        {onRemove ? (
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={TASK_COPY.setup.remove(number.examNumber)}
            disabled={disabled}
            onClick={onRemove}
          >
            <X className={layout.tasks.icon} />
          </Button>
        ) : null}
      </div>
      <div className={layout.trainingSetup.countGroup}>
        <div className={layout.trainingSetup.countHeading}>
          <div className={layout.trainingSetup.countLabel}>
            <span>{TASK_COPY.setup.count}</span>
            <span className={layout.trainingSetup.countAvailability}>
              {TASK_COPY.setup.available(number.available)}
            </span>
          </div>
          <Button
            variant="ghost"
            size="compact"
            className={cn(
              layout.trainingSetup.adjustment,
              !number.adjustmentCount && layout.trainingSetup.adjustmentPlaceholder,
            )}
            disabled={disabled || !number.adjustmentCount}
            aria-hidden={!number.adjustmentCount}
            onClick={() => number.adjustmentCount && onCountChange(number.adjustmentCount)}
          >
            {TASK_COPY.setup.useAvailable(number.adjustmentCount ?? selection.count)}
          </Button>
        </div>
        <div
          className={layout.trainingSetup.counts}
          role="group"
          aria-label={TASK_COPY.setup.count}
        >
          {number.countOptions.map((option) => (
            <Button
              key={option.count}
              variant={selection.count === option.count ? 'default' : 'outline'}
              aria-pressed={selection.count === option.count}
              disabled={disabled || option.disabled}
              disabledReason={
                disabled ? undefined : TASK_COPY.setup.countUnavailable(number.available)
              }
              onClick={() => onCountChange(option.count)}
            >
              {option.count}
            </Button>
          ))}
        </div>
      </div>
      {number.topics.length ? (
        <details className={layout.trainingSetup.topics}>
          <summary className={layout.trainingSetup.topicToggle}>
            {selection.topicIds?.length
              ? TASK_COPY.setup.selectedTopics(selection.topicIds.length)
              : LEARNING_COPY.allTopics}
            <ChevronDown className={layout.trainingSetup.topicChevron} />
          </summary>
          <div className={layout.trainingSetup.topicList}>
            <TopicOption
              title={LEARNING_COPY.allTopics}
              selected={!selection.topicIds?.length}
              disabled={disabled}
              onClick={() => onTopicChange()}
            />
            {number.topics.map((topic) => (
              <TopicOption
                key={topic.id}
                title={topic.title}
                selected={topic.selected}
                disabled={disabled || (!topic.available && !topic.selected)}
                disabledReason={disabled ? undefined : TASK_COPY.setup.emptyNumber}
                onClick={() => onTopicChange(topic.id)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function TopicOption({
  title,
  selected,
  disabled,
  disabledReason,
  onClick,
}: {
  title: string;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="card"
      className={cn(
        layout.trainingSetup.topicOption,
        selected && layout.trainingSetup.topicSelected,
      )}
      aria-pressed={selected}
      disabled={disabled}
      disabledReason={disabledReason}
      onClick={onClick}
    >
      <span className={layout.trainingSetup.topicText}>{title}</span>
      {selected ? (
        <Check className={layout.trainingSetup.topicCheck} />
      ) : (
        <span className={layout.trainingSetup.topicPlaceholder} />
      )}
    </Button>
  );
}
