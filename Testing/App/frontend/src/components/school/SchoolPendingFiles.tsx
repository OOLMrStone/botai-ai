import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SCHOOL_COPY as C } from '@/config/school';
import { MOTION_STYLES } from '@/config/motion';
import { layout } from '@/config/layout';
import type { SchoolSubmissionActions } from '@/hooks/use-school-submission';
import { cn } from '@/lib/utils';

export function SchoolPendingFiles({ actions }: { actions: SchoolSubmissionActions }) {
  if (!actions.pendingFiles.length) return null;
  const styles = layout.school;

  if (actions.busy)
    return (
      <p role="status" className={styles.status}>
        <Loader2 className={cn(styles.statusIcon, MOTION_STYLES.loadingSpin)} aria-hidden="true" />
        {C.uploadingFiles}
      </p>
    );

  return (
    <div className={styles.stack}>
      <p className={styles.hint}>{C.pendingFiles(actions.pendingFiles.length)}</p>
      <Button variant="outline" onClick={() => void actions.retryUpload()}>
        {C.retryUpload}
      </Button>
      <Button variant="ghost" onClick={actions.clearPendingFiles}>
        {C.clearPendingFiles}
      </Button>
    </div>
  );
}
