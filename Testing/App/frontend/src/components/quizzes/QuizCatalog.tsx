import { ArrowUpRight } from 'lucide-react';

import { MathFormula } from '@/components/common/MathFormula';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { layout } from '@/config/layout';
import { QUIZ_TOPICS } from '@/config/quiz-content';
import { QUIZ_COPY } from '@/config/quiz';
import { useQuizStore } from '@/stores/quiz-store';
import { cn } from '@/lib/utils';

export function QuizCatalog() {
  const selectTopic = useQuizStore((state) => state.selectTopic);

  return (
    <>
      <ScreenHeading variant="app" title={QUIZ_COPY.title} />
      <div className={cn(layout.scroll, layout.quiz.catalog)}>
        {QUIZ_TOPICS.map((topic) => (
          <button
            key={topic.id}
            onClick={() => selectTopic(topic.id)}
            className={cn(layout.quiz.topic, layout.quiz.surface, layout.focusRing)}
          >
            <div className={layout.quiz.topicTop}>
              <span className={layout.quiz.badge}>{topic.eyebrow}</span>
              <ArrowUpRight className={layout.quiz.icon} />
            </div>
            <MathFormula value={topic.formula} className={layout.quiz.topicArt} />
            <div className={layout.quiz.compact}>
              <h2 className={layout.quiz.topicTitle}>{topic.title}</h2>
              <p className={layout.quiz.body}>{topic.description}</p>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
