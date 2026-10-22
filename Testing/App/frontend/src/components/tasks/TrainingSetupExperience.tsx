'use client';

import { ArrowRight, ChevronDown } from 'lucide-react';

import { ActivitySetupScreen } from '@/components/common/ActivitySetupScreen';
import { ErrorNote } from '@/components/common/ErrorNote';
import { FormSection } from '@/components/common/FormSection';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { TrainingDifficultySlider } from '@/components/tasks/TrainingDifficultySlider';
import { TrainingSetupNumber } from '@/components/tasks/TrainingSetupNumber';
import { Button } from '@/components/ui/button';
import { LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import { TASK_COPY } from '@/config/tasks';
import { useTrainingSetupPage } from '@/hooks/use-training-setup-page';
import type { Task } from '@/lib/api/learning-types';
import { cn } from '@/lib/utils';

export function TrainingSetupExperience({
  tasks,
  fixedExamNumber,
}: {
  tasks: Task[];
  fixedExamNumber: number | null;
}) {
  const { pickerToggleRef, ...setup } = useTrainingSetupPage(tasks, fixedExamNumber);

  return (
    <ActivitySetupScreen
      closeLabel={TASK_COPY.close}
      onClose={setup.close}
      footer={
        <div className={layout.trainingSetup.footer}>
          {setup.error ? <ErrorNote message={setup.error} /> : null}
          <p className={layout.trainingSetup.footerSummary} aria-live="polite">
            {setup.total
              ? TASK_COPY.setup.selectedTasks(setup.total)
              : TASK_COPY.setup.chooseNumbers}
          </p>
          <Button
            className={layout.cta}
            disabled={!setup.canStart}
            disabledReason={setup.startDisabledReason}
            onClick={() => void setup.start()}
          >
            {setup.busy ? TASK_COPY.setup.starting : TASK_COPY.setup.start}
            <ArrowRight className={layout.tasks.icon} />
          </Button>
        </div>
      }
    >
      <div className={cn(layout.scroll, layout.trainingSetup.content)}>
        <ScreenHeading
          variant="app"
          title={TASK_COPY.setup.title}
          subtitle={setup.canChooseNumbers ? TASK_COPY.setup.subtitle : undefined}
        />
        {setup.catalog.failed ? (
          <ErrorNote message={LEARNING_COPY.loadError} onRetry={setup.catalog.retry} />
        ) : null}
        {setup.canChooseNumbers ? (
          <details
            open={setup.numbersOpen}
            onToggle={(event) => setup.setNumbersOpen(event.currentTarget.open)}
            className={layout.trainingSetup.numberPicker}
          >
            <summary ref={pickerToggleRef} className={layout.trainingSetup.topicToggle}>
              {setup.selections.length ? TASK_COPY.setup.addNumber : TASK_COPY.setup.numbers}
              <ChevronDown className={layout.trainingSetup.topicChevron} />
            </summary>
            <div className={layout.trainingSetup.numberGrid}>
              {setup.numbers.map((number) => (
                <Button
                  key={number.examNumber}
                  variant={number.selection ? 'default' : 'outline'}
                  className={layout.trainingSetup.numberButton}
                  aria-label={TASK_COPY.setup.exam(number.examNumber, number.title)}
                  title={number.title}
                  aria-pressed={Boolean(number.selection)}
                  disabled={setup.busy || (!number.available && !number.selection)}
                  disabledReason={setup.busy ? undefined : TASK_COPY.setup.emptyNumber}
                  onClick={() => setup.toggle(number.examNumber)}
                >
                  {number.examNumber}
                </Button>
              ))}
            </div>
          </details>
        ) : null}
        <div className={layout.trainingSetup.selections}>
          {setup.numbers.map((number) =>
            number.selection ? (
              <TrainingSetupNumber
                key={number.examNumber}
                number={number}
                selection={number.selection}
                disabled={setup.busy}
                onRemove={
                  setup.canChooseNumbers ? () => setup.toggle(number.examNumber) : undefined
                }
                onCountChange={(count) => setup.update(number.examNumber, { count })}
                onTopicChange={(topicId) => setup.toggleTopic(number.examNumber, topicId)}
              />
            ) : null,
          )}
        </div>
        <FormSection title={TASK_COPY.setup.difficulty}>
          <TrainingDifficultySlider
            value={setup.difficultyLevel}
            valueLabel={TASK_COPY.setup.difficultyLevels[setup.difficultyLabelKey]}
            disabled={setup.busy}
            onChange={setup.setDifficultyLevel}
          />
        </FormSection>
        <details className={layout.trainingSetup.topics}>
          <summary className={layout.trainingSetup.topicToggle}>
            {TASK_COPY.setup.selectionExplainer}
            <ChevronDown className={layout.trainingSetup.topicChevron} />
          </summary>
          <p className={layout.trainingSetup.hint}>{TASK_COPY.setup.selectionRules}</p>
        </details>
      </div>
    </ActivitySetupScreen>
  );
}
