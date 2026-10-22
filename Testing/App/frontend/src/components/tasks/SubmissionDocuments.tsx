import { X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { INTEGRATION, LEARNING_COPY as C } from '@/config/integration';
import { layout } from '@/config/layout';
import type { SolutionDocument } from '@/lib/api/learning-types';
import { solutionDocumentError } from '@/lib/solution-validation';

export function SubmissionDocuments({
  documents,
  canRemove,
  onRemove,
  showRemove = true,
}: {
  documents: SolutionDocument[];
  canRemove: boolean;
  onRemove: (id: string) => void;
  showRemove?: boolean;
}) {
  return documents.map((document) => (
    <div key={document.id} className={layout.integration.feedback}>
      <p className={layout.integration.feedbackStatus}>{document.fileName}</p>
      <p className={layout.typography.description} role="status">
        {document.state === 'processing'
          ? C.pdfProcessing
          : document.state === 'failed'
            ? solutionDocumentError(document.errorCode)
            : document.pageCount
              ? C.documentPages(document.pageCount)
              : null}
      </p>
      <div className={layout.integration.feedbackActions}>
        {document.state === 'ready' && document.downloadUrl ? (
          <Button
            variant="outline"
            size="compact"
            nativeButton={false}
            render={
              <a
                href={document.downloadUrl}
                download={document.fileName}
                type={INTEGRATION.pdfType}
              />
            }
          >
            <Download aria-hidden="true" className={layout.integration.feedbackIcon} />
            {C.downloadDocument}
          </Button>
        ) : null}
        {showRemove ? (
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={C.removeDocument}
            disabled={!canRemove}
            onClick={() => onRemove(document.id)}
          >
            <X aria-hidden="true" className={layout.integration.feedbackIcon} />
          </Button>
        ) : null}
      </div>
    </div>
  ));
}
