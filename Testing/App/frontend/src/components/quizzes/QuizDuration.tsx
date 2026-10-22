import { RangeSlider } from '@/components/common/RangeSlider';
import { FormSection } from '@/components/common/FormSection';
import { QUIZ_COPY, QUIZ_LENGTHS, QUIZ_DURATION_SLIDER } from '@/config/quiz';
import { useQuizStore } from '@/stores/quiz-store';

export function QuizDuration() {
  const length = useQuizStore((state) => state.length);
  const setLength = useQuizStore((state) => state.setLength);
  const index = QUIZ_LENGTHS.findIndex((option) => option.id === length);
  const option = QUIZ_LENGTHS[index];

  return (
    <FormSection title={QUIZ_COPY.duration}>
      <RangeSlider
        {...QUIZ_DURATION_SLIDER}
        value={index}
        valueLabel={option.title}
        label={QUIZ_COPY.duration}
        scale={QUIZ_LENGTHS.map((item) => item.description)}
        onChange={(value) => setLength(QUIZ_LENGTHS[value].id)}
      />
    </FormSection>
  );
}
