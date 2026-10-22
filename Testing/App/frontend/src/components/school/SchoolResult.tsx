import { SchoolResultBlock } from '@/components/school/SchoolResultBlock';
import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { SCHOOL_COPY as C } from '@/config/school';
import { layout } from '@/config/layout';
import type { SchoolSubmission } from '@/lib/api/school-types';
import { schoolResultBlocks } from '@/lib/school';
import { cn } from '@/lib/utils';

export function SchoolResult({
  submission,
  maxScore,
}: {
  submission: SchoolSubmission;
  maxScore: number;
}) {
  const result = submission.result;
  if (submission.status !== 'returned' || submission.expertReview?.status !== 'sent' || !result)
    return null;
  const styles = layout.school;
  const blocks = schoolResultBlocks(result, submission.imageArtifacts);
  const grading = result.grading;

  return (
    <section className={styles.section}>
      <ScreenHeading title={C.result} variant="task" as="h2" />
      {grading ? (
        <p
          className={cn(
            styles.score,
            grading.score === 0
              ? styles.scoreZero
              : grading.score === maxScore
                ? styles.scoreFull
                : styles.scorePartial,
          )}
        >
          {C.score(grading.score, maxScore)}
        </p>
      ) : (
        <p className={styles.hint}>{C.noGrade}</p>
      )}
      {grading?.explanation ? (
        <ExpertRichText value={grading.explanation} className={styles.resultText} />
      ) : null}
      {result.rejection_reason ? (
        <ExpertRichText value={result.rejection_reason} className={styles.resultText} />
      ) : null}
      {blocks.length ? (
        <div className={styles.result}>
          <ScreenHeading title={C.review} variant="task" as="h3" />
          {blocks.map((block) => (
            <SchoolResultBlock key={block.id} block={block} />
          ))}
        </div>
      ) : null}
      {result.analysis?.findings.map((finding) => (
        <div key={finding.id} className={styles.resultNote}>
          <ExpertRichText value={finding.description} className={styles.resultText} />
          {finding.advice ? (
            <ExpertRichText value={finding.advice} className={styles.resultText} />
          ) : null}
        </div>
      ))}
    </section>
  );
}
