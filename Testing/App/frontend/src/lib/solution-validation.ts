import { INTEGRATION, LEARNING_COPY } from '@/config/integration';
import { imageRejection } from '@/lib/image-validation';
import type { Submission } from '@/lib/api/learning-types';

export const solutionFileIsPdf = (file: Pick<File, 'type'>) => file.type === INTEGRATION.pdfType;

export async function solutionFileRejection(file: File) {
  if (file.size > INTEGRATION.maxImageBytes) return LEARNING_COPY.solutionFileSize;
  // Страницы и содержимое PDF проверяет изолированный серверный конвертер.
  if (solutionFileIsPdf(file)) return null;
  if (!INTEGRATION.imageTypes.some((type) => type === file.type))
    return LEARNING_COPY.solutionFileType;
  const reason = await imageRejection(file);

  return reason ? LEARNING_COPY[reason] : null;
}

export function submissionDocumentsProcessing(submission?: Submission) {
  return Boolean(submission?.documents?.some((document) => document.state === 'processing'));
}

export function submissionPagesReady(submission?: Submission) {
  return Boolean(
    submission?.images.length &&
    (submission.documents ?? []).every((document) => document.state === 'ready') &&
    submission.images.every((image) => image.status === 'ready'),
  );
}

export function solutionDocumentError(errorCode: string | null) {
  switch (errorCode) {
    case 'pdf_page_budget':
    case 'page_budget':
    case 'image_count':
      return LEARNING_COPY.image_count;
    case 'pdf_encrypted':
    case 'encrypted':
      return LEARNING_COPY.pdfEncrypted;
    case 'pdf_active_content':
    case 'active_content':
      return LEARNING_COPY.pdfActiveContent;
    case 'pdf_invalid':
    case 'invalid':
    case 'pdf_geometry':
    case 'geometry':
      return LEARNING_COPY.pdfInvalid;
    case 'renderer_unavailable':
    case 'pdf_renderer_unavailable':
    case 'pdf_timeout':
      return LEARNING_COPY.pdfUnavailable;
    default:
      return LEARNING_COPY.pdfFailed;
  }
}
