import { SCHOOL, SCHOOL_COPY } from '@/config/school';
import type { SchoolStatus, SchoolSubmission } from '@/lib/api/school-types';
import { expertBlockFromCanonical } from '@/lib/expert-adapter';
import type { ExpertCanonicalDocument, ExpertImageArtifactDto } from '@/lib/api/expert-types';
import type { Attachment } from '@/lib/api/learning-types';

export function schoolAttachmentLabel(image: Attachment) {
  return image.sourceDocumentId && image.pageNumber != null
    ? SCHOOL_COPY.page(image.pageNumber)
    : image.fileName;
}

export function schoolStatusPolling(status: SchoolStatus) {
  if (status === 'queued' || status === 'running') return SCHOOL.processingPollMs;
  if (status === 'awaiting_expert' || status === 'reviewing') return SCHOOL.reviewPollMs;
  return null;
}

export function schoolPollDelay(submission: SchoolSubmission | null) {
  if (!submission) return null;
  if (
    submission.status === 'draft' &&
    submission.documents.some((document) => document.state === 'processing')
  )
    return SCHOOL.processingPollMs;
  return schoolStatusPolling(submission.status);
}

export function schoolSendDisabled(submission: SchoolSubmission | null, busy: boolean) {
  if (busy) return SCHOOL_COPY.busy;
  if (submission?.documents.some((document) => document.state === 'processing'))
    return SCHOOL_COPY.filesPreparing;
  if (submission?.documents.some((document) => document.state !== 'ready'))
    return SCHOOL_COPY.filesFailed;
  if (!submission?.images.length || submission.images.some((image) => image.status !== 'ready'))
    return SCHOOL_COPY.filesRequired;
  return null;
}

export function schoolCanRetry(submission: SchoolSubmission | null) {
  return Boolean(
    submission?.retryable &&
    (submission.status === 'failed' ||
      submission.status === 'cancelled' ||
      submission.status === 'expired'),
  );
}

export function schoolResultBlocks(
  result: ExpertCanonicalDocument,
  artifacts: ExpertImageArtifactDto[] = [],
) {
  const reviews = new Map(
    result.analysis?.block_reviews.map((review) => [review.block_id, review]),
  );
  return (result.ocr?.blocks ?? []).flatMap((block, index) => {
    const review = reviews.get(block.id);
    return review ? [expertBlockFromCanonical(block, index, review, artifacts)] : [];
  });
}
