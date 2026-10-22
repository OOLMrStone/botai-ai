import type { ExpertTask, ExpertWork } from '@/config/expert';
import { sameExpertData } from '@/lib/expert';
import { expertDocument } from '@/lib/expert-adapter';

function rebaseGradedDraft(
  draft: ExpertTask,
  baseline: ExpertTask | undefined,
  incoming: ExpertTask | undefined,
): ExpertTask {
  if (
    !baseline?.backend ||
    !incoming?.backend ||
    incoming.readOnly ||
    incoming.revision <= baseline.revision ||
    draft.revision !== baseline.revision ||
    !baseline.gradingJob ||
    !['pending', 'unknown'].includes(baseline.gradingJob.state) ||
    incoming.gradingJob?.id !== baseline.gradingJob.id ||
    incoming.gradingJob.state !== 'succeeded' ||
    !sameExpertData(draft.backend, baseline.backend)
  )
    return draft;

  const previousDocument = expertDocument(baseline.backend.document);
  const nextDocument = expertDocument(incoming.backend.document);
  if (
    !sameExpertData(previousDocument.ocr, nextDocument.ocr) ||
    !sameExpertData(previousDocument.analysis, nextDocument.analysis) ||
    !sameExpertData(previousDocument.solution_image_ids, nextDocument.solution_image_ids)
  )
    return draft;

  // Собственный grading-only не меняет основу локального разбора; чужие правки сюда не проходят.
  return {
    ...draft,
    revision: incoming.revision,
    backend: structuredClone(incoming.backend),
    gradingJob: incoming.gradingJob,
    analysis: {
      ...draft.analysis,
      ...(draft.manualGradePending
        ? {}
        : {
            score: incoming.analysis.score,
            criterion: incoming.analysis.criterion,
            verdict: incoming.analysis.verdict,
            hasGrade: incoming.analysis.hasGrade,
            gradeStale: true,
          }),
    },
  };
}

export function rebaseExpertDrafts(
  drafts: Record<string, ExpertTask>,
  previousWorks: ExpertWork[],
  incomingWorks: ExpertWork[],
): Record<string, ExpertTask> {
  return Object.fromEntries(
    Object.entries(drafts).map(([id, draft]) => {
      const work = previousWorks.find((candidate) =>
        candidate.tasks.some((task) => task.id === id),
      );
      const baseline = work?.tasks.find((task) => task.id === id);
      const incoming = incomingWorks
        .find((candidate) => candidate.id === work?.id)
        ?.tasks.find((task) => task.id === id);

      return [id, rebaseGradedDraft(draft, baseline, incoming)];
    }),
  );
}
