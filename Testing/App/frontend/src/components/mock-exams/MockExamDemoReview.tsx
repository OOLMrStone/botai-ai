import { Check, ChevronDown, Lightbulb, LoaderCircle } from 'lucide-react';
import Image from 'next/image';

import { MathFormula } from '@/components/common/MathFormula';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { layout } from '@/config/layout';
import { MOCK_EXAM_DEMO, MOCK_EXAM_DEMO_COPY as COPY } from '@/config/mock-exam-demo';
import type { DemoReviewStage } from '@/stores/mock-exam-demo-store';

export function MockExamDemoReview({
  stage,
  completed,
  previewUrl,
}: {
  stage: DemoReviewStage;
  completed: boolean;
  previewUrl: string | null;
}) {
  const styles = layout.mockExamDemo;

  return (
    <section className={styles.card} aria-label={COPY.title}>
      {completed ? (
        <div className={styles.content}>
          <ScreenHeading title={COPY.title} variant="task" />
          <div className={styles.scores} role="status">
            <div className={styles.primary}>
              <div className={styles.scoreLine}>
                <span className={styles.score}>{MOCK_EXAM_DEMO.score}</span>
                <span className={styles.scoreMax}>{COPY.outOf(MOCK_EXAM_DEMO.maxScore)}</span>
              </div>
              <p className={styles.scoreLabel}>{COPY.withFormatting}</p>
            </div>
            <div className={styles.secondary}>
              <p className={styles.secondaryScore}>
                {COPY.score(MOCK_EXAM_DEMO.score, MOCK_EXAM_DEMO.maxScore)}
              </p>
              <p className={styles.meta}>{COPY.withoutFormatting}</p>
              <p className={styles.caption}>{COPY.learningMetric}</p>
            </div>
          </div>
          <div className={styles.tips}>
            <h2 className={styles.tipsHeading}>
              <Lightbulb className={styles.tipIcon} aria-hidden="true" />
              {COPY.improvements}
            </h2>
            {COPY.tips.map((tip) => (
              <div key={tip.title} className={styles.tip}>
                <h3 className={styles.tipTitle}>{tip.title}</h3>
                <p className={styles.tipDescription}>{tip.description}</p>
              </div>
            ))}
          </div>
          <details className={styles.example}>
            <summary className={styles.exampleToggle}>
              <span>{COPY.example}</span>
              <span className={styles.exampleChevronFrame}>
                <ChevronDown className={styles.exampleChevron} aria-hidden="true" />
              </span>
            </summary>
            <div className={styles.exampleContent}>
              <p className={styles.exampleIntro}>{COPY.exampleIntro}</p>
              <div className={styles.exampleSteps}>
                {COPY.exampleSteps.map((step, index) => (
                  <div key={step.title} className={styles.exampleStep}>
                    <span className={styles.exampleStepNumber}>{index + 1}</span>
                    <div className={styles.exampleStepBody}>
                      <h3 className={styles.exampleStepTitle}>{step.title}</h3>
                      <MathFormula value={step.formula} className={styles.exampleFormula} />
                    </div>
                  </div>
                ))}
              </div>
              <p className={styles.exampleResult}>{COPY.exampleResult}</p>
            </div>
          </details>
        </div>
      ) : (
        <div className={styles.loading}>
          {previewUrl ? (
            <div className={styles.photo}>
              <Image
                src={previewUrl}
                alt={COPY.photoAlt}
                fill
                unoptimized
                className={styles.photoImage}
              />
            </div>
          ) : null}
          <div className={styles.loadingLabel} role="status" aria-live="polite">
            {stage === 'ready' ? (
              <Check className={styles.readyIcon} aria-hidden="true" />
            ) : (
              <LoaderCircle className={styles.spinner} aria-hidden="true" />
            )}
            <div className={styles.loadingTitle}>
              <ScreenHeading
                title={
                  stage === 'photo' ? COPY.photo : stage === 'ready' ? COPY.ready : COPY.solution
                }
                variant="task"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
