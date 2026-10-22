import { PERSONAL_LAYOUT_FIXTURE as CONFIG } from '@/config/personal-layout-fixture';
import type { ExpertCanonicalDocument, ExpertWorkDto } from '@/lib/api/expert-types';
import type { PipelineRunDetail } from '@/lib/api/pipeline-console-types';
import { expertDocument, expertWorkFromDto } from '@/lib/expert-adapter';

export interface PersonalLayoutManifest {
  schemaVersion: string;
  enabled: boolean;
  fixtureId: string;
  ruleVersion: string;
  taskId: string;
  assignmentId: string;
  schoolId: string;
  expertId: string;
  studentId: string;
  taskNumber: number;
  maxScore: number;
  expectedImageCount: number;
  normalizedImageSha256: string;
  normalizedImageBytes: number;
  expectedRevision: number;
  fixtureSha256: string;
}

export interface PersonalLayoutProjection {
  workId: string;
  submissionId: string;
  revision: number;
  imageId: string;
  review: ExpertCanonicalDocument;
}

export function isUneditedGradedWork(work: ExpertWorkDto) {
  const ai = work.aiResult;
  return (
    work.status === 'queued' &&
    work.revision === CONFIG.revision &&
    !work.isDemo &&
    !work.gradeJob &&
    !work.sentAt &&
    work.images.length === CONFIG.imageCount &&
    ai?.phase === 'graded' &&
    ai.origin === 'structured_ai' &&
    ai.rejection_reason === null &&
    ai.grading !== null &&
    Number.isInteger(ai.grading.score) &&
    ai.grading.score >= 0 &&
    ai.grading.score <= work.maxScore &&
    JSON.stringify(work.review) === JSON.stringify(ai)
  );
}

export function matchesPersonalLayout(
  manifest: PersonalLayoutManifest,
  work: ExpertWorkDto,
  run: PipelineRunDetail,
  imageSha256: string,
) {
  return (
    manifest.enabled &&
    isUneditedGradedWork(work) &&
    manifest.expectedImageCount === CONFIG.imageCount &&
    manifest.expectedRevision === CONFIG.revision &&
    work.student.id === manifest.studentId &&
    work.taskNumber === manifest.taskNumber &&
    work.maxScore === manifest.maxScore &&
    run.origin === 'school' &&
    run.assignmentId === manifest.assignmentId &&
    run.submissionId === work.submissionId &&
    run.workId === work.id &&
    run.taskNumber === manifest.taskNumber &&
    run.errorCode === null &&
    run.isDemo === false &&
    run.state === 'awaiting_expert' &&
    run.aiResult?.phase === 'graded' &&
    run.images.length === CONFIG.imageCount &&
    run.images[0].id === work.images[0].id &&
    work.aiResult.solution_image_ids.length === CONFIG.imageCount &&
    work.aiResult.solution_image_ids[0] === work.images[0].id &&
    imageSha256 === manifest.normalizedImageSha256
  );
}

export function bindPersonalLayoutReview(value: unknown, imageId: string) {
  const review = expertDocument(structuredClone(value));
  if (
    review.schema_version !== 'expert-review.v2' ||
    review.origin !== 'expert' ||
    review.phase !== 'graded' ||
    review.solution_image_ids.length !== 0 ||
    !review.ocr
  )
    throw new Error('Invalid private presentation fixture');
  review.solution_image_ids = [imageId];
  for (const block of review.ocr.blocks) {
    // Этот fixture не содержит чужих crop-артефактов или привязок к удалённым загрузкам.
    if (block.sources.length || (block.content.type === 'step' && block.content.image))
      throw new Error('Unexpected private presentation source');
  }
  return review;
}

export function projectPersonalLayout(work: ExpertWorkDto, projection: PersonalLayoutProjection) {
  if (
    !isUneditedGradedWork(work) ||
    projection.workId !== work.id ||
    projection.submissionId !== work.submissionId ||
    projection.revision !== work.revision ||
    projection.imageId !== work.images[0].id
  )
    return expertWorkFromDto(work);
  const projected = expertWorkFromDto({ ...work, review: projection.review, gradingStale: false });
  for (const task of projected.tasks) {
    task.readOnly = false;
    task.manualGradePending = true;
  }
  return projected;
}

export function personalLayoutSessionCookie(header: string | null) {
  const matches =
    header
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${CONFIG.sessionCookieName}=`)) ?? [];
  if (matches.length !== 1 || matches[0].length > CONFIG.maxSessionCookieBytes) return null;
  const value = matches[0].slice(CONFIG.sessionCookieName.length + 1);
  return value && /^[A-Za-z0-9%._~+/=-]+$/.test(value) ? matches[0] : null;
}
