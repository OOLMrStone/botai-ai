import Image from 'next/image';
import { X } from 'lucide-react';
import { SubmissionDocuments } from '@/components/tasks/SubmissionDocuments';
import { Button } from '@/components/ui/button';
import { SCHOOL } from '@/config/school';
import { LEARNING_COPY } from '@/config/integration';
import { layout } from '@/config/layout';
import type { SchoolSubmission } from '@/lib/api/school-types';
import type { SchoolSubmissionActions } from '@/hooks/use-school-submission';
import { schoolAttachmentLabel } from '@/lib/school';

export function SchoolFiles({
  submission,
  actions,
  editable,
}: {
  submission: SchoolSubmission;
  actions: SchoolSubmissionActions;
  editable: boolean;
}) {
  const styles = layout.school;
  return (
    <>
      <SubmissionDocuments
        documents={submission.documents}
        canRemove={editable && !actions.busy}
        showRemove={editable}
        onRemove={(id) => void actions.removeDocument(id)}
      />
      {submission.images.length ? (
        <div className={styles.attachments}>
          {submission.images.map((image) => (
            <div className={styles.attachment} key={image.id}>
              <a
                href={image.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.imageLink}
              >
                <Image
                  src={image.previewUrl}
                  alt={schoolAttachmentLabel(image)}
                  fill
                  unoptimized
                  sizes={SCHOOL.imageSizes}
                  className={styles.image}
                />
              </a>
              <div className={styles.imageActions}>
                <span className={styles.fileName}>{schoolAttachmentLabel(image)}</span>
                {editable && !image.sourceDocumentId ? (
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    aria-label={LEARNING_COPY.removePhoto}
                    disabled={actions.busy}
                    onClick={() => void actions.removeImage(image.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
