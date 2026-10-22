import { ExpertPhotoViewer } from '@/components/expert/ExpertPhotoViewer';
import type { ExpertTask } from '@/config/expert';
import { EXPERT_UI_COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';

export function ExpertSourcePane({
  task,
  onClose,
}: {
  task: Pick<ExpertTask, 'sourceImages' | 'sourceImage'>;
  onClose: () => void;
}) {
  const styles = layout.expertSource;

  return (
    <section className={styles.pane} aria-label={EXPERT_UI_COPY.sourceOriginal}>
      <div className={styles.paneBody}>
        <ExpertPhotoViewer task={task} variant="pane" onCollapse={onClose} />
      </div>
    </section>
  );
}
