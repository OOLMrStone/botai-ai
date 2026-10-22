'use client';

import { ArrowRight, X } from 'lucide-react';
import { ActivitySetupScreen } from '@/components/common/ActivitySetupScreen';
import { AppNavigation } from '@/components/app/AppNavigation';

import { ScreenShell } from '@/components/onboarding/ScreenShell';
import { QuizCatalog } from '@/components/quizzes/QuizCatalog';
import { QuizSetup } from '@/components/quizzes/QuizSetup';
import { QuizQuestion } from '@/components/quizzes/QuizQuestion';
import { QuizResult } from '@/components/quizzes/QuizResult';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { QUIZ_COPY } from '@/config/quiz';
import { useQuiz } from '@/hooks/use-quiz';

function QuizFooter() {
  const { stage, ready, feedback, finished, start, check, next, exit, topicId, selectTopic } =
    useQuiz();
  if (stage === 'catalog') return null;
  if (stage === 'result')
    return (
      <div className={layout.quiz.resultActions}>
        <Button
          size="default"
          className={layout.cta}
          onClick={() => topicId && selectTopic(topicId)}
        >
          {QUIZ_COPY.again}
        </Button>
        <Button variant="ghost" size="default" className={layout.cta} onClick={exit}>
          {QUIZ_COPY.catalog}
        </Button>
      </div>
    );

  return (
    <Button
      size="default"
      variant={feedback === 'correct' ? 'success' : feedback === 'incorrect' ? 'error' : 'default'}
      className={layout.cta}
      disabled={stage === 'playing' && !ready && !feedback}
      onClick={stage === 'setup' ? start : feedback ? next : check}
    >
      {stage === 'setup'
        ? QUIZ_COPY.start
        : feedback
          ? finished
            ? QUIZ_COPY.finish
            : QUIZ_COPY.next
          : QUIZ_COPY.check}
      <ArrowRight className={layout.quiz.icon} />
    </Button>
  );
}

const SCREENS = {
  catalog: QuizCatalog,
  setup: QuizSetup,
  playing: QuizQuestion,
  result: QuizResult,
};

export function QuizExperience() {
  const { stage, index, questions, progress, exit } = useQuiz();
  const Screen = SCREENS[stage];

  if (stage === 'setup') {
    return (
      <ActivitySetupScreen closeLabel={QUIZ_COPY.close} onClose={exit} footer={<QuizFooter />}>
        <QuizSetup />
      </ActivitySetupScreen>
    );
  }

  return (
    <div className={stage === 'catalog' ? layout.learning.app : layout.quiz.root}>
      <main className={stage === 'catalog' ? layout.learning.main : layout.quiz.content}>
        {stage !== 'catalog' && (
          <header className={layout.quiz.header}>
            <Button
              variant="ghost"
              size="icon-compact"
              className={layout.quiz.iconButton}
              aria-label={QUIZ_COPY.close}
              onClick={exit}
            >
              <X className={layout.quiz.icon} />
            </Button>
            {stage === 'playing' ? (
              <>
                <div
                  role="progressbar"
                  aria-label={QUIZ_COPY.progress}
                  aria-valuenow={progress * questions.length}
                  aria-valuemin={0}
                  aria-valuemax={questions.length}
                  className={layout.quiz.progress}
                >
                  <div
                    className={layout.quiz.progressFill}
                    style={{ transform: `scaleX(${progress})` }}
                  />
                </div>
                <span className={layout.quiz.headerSide}>
                  {index + 1}/{questions.length}
                </span>
              </>
            ) : null}
          </header>
        )}
        <ScreenShell
          footer={stage === 'catalog' ? undefined : <QuizFooter />}
          bottomNavigation={stage === 'catalog'}
        >
          <Screen key={`${stage}-${index}`} />
        </ScreenShell>
      </main>
      {stage === 'catalog' && <AppNavigation />}
    </div>
  );
}
