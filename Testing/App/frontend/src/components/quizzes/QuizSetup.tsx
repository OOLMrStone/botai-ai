import { FormSection } from '@/components/common/FormSection';
import { SelectableCard } from '@/components/onboarding/SelectableCard';
import { RadioGroup } from '@/components/ui/radio-group';
import { QuizDuration } from '@/components/quizzes/QuizDuration';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { layout } from '@/config/layout';
import { QUIZ_COPY, QUIZ_DIFFICULTIES } from '@/config/quiz';
import { useQuiz } from '@/hooks/use-quiz';
import { cn } from '@/lib/utils';

export function QuizSetup() {
  const { topic, difficulty, setDifficulty } = useQuiz();
  if (!topic) return null;

  return (
    <div className={cn(layout.scroll, layout.quiz.stack)}>
      <ScreenHeading variant="app" title={QUIZ_COPY.setupTitles[topic.id]} />
      <FormSection title={QUIZ_COPY.difficulty}>
        <RadioGroup
          value={difficulty}
          onValueChange={(value) => setDifficulty(value === 'challenge' ? 'challenge' : 'basic')}
          className={layout.quiz.choiceGrid}
        >
          {QUIZ_DIFFICULTIES.map((option) => (
            <SelectableCard key={option.id} value={option.id} label={option.title} />
          ))}
        </RadioGroup>
      </FormSection>
      <QuizDuration />
    </div>
  );
}
