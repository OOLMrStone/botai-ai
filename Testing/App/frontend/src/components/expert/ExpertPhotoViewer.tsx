'use client';

import Image from 'next/image';
import { ExpertSourceToolbar } from '@/components/expert/ExpertSourceToolbar';
import { Button } from '@/components/ui/button';
import { EXPERT_COPY, type ExpertTask } from '@/config/expert';
import { EXPERT_UI_COPY as COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { useExpertPhotoViewer } from '@/hooks/use-expert-photo-viewer';
import { preventGestureContextMenu } from '@/lib/gesture-surface';
import { cn } from '@/lib/utils';

export function ExpertPhotoViewer({
  task,
  variant = 'dialog',
  onCollapse,
}: {
  task: Pick<ExpertTask, 'sourceImages' | 'sourceImage'>;
  variant?: 'dialog' | 'compare' | 'pane';
  onCollapse?: () => void;
}) {
  const viewer = useExpertPhotoViewer(task, variant === 'pane');
  const {
    photo: selectedPhoto,
    surfaceRef,
    viewportRef,
    imageStyle,
    imageLoaded,
    canZoomOut,
    startPan,
    pan,
    stopPan,
    failed,
    fail,
    retry,
  } = viewer;
  const styles = layout.expert;

  if (!selectedPhoto) return <p className={styles.sourceMissing}>{EXPERT_COPY.noSource}</p>;

  return (
    <div
      ref={surfaceRef}
      className={cn(
        styles.photoViewer,
        layout.gestureSurface,
        variant === 'compare' && styles.photoViewerCompare,
      )}
      onContextMenu={preventGestureContextMenu}
    >
      <ExpertSourceToolbar viewer={viewer} inPane={variant === 'pane'} onCollapse={onCollapse} />
      <div
        ref={viewportRef}
        tabIndex={0}
        aria-label={COPY.sourceOriginal}
        className={cn(
          styles.photoViewerViewport,
          layout.expertSource.viewportFocus,
          variant === 'pane' && layout.expertSource.paneViewport,
          canZoomOut && styles.photoViewerPannable,
        )}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
      >
        {failed ? (
          <div className={styles.photoViewerError} role="status">
            <p>{COPY.sourceUnavailable}</p>
            <Button variant="outline" size="compact" onClick={retry}>
              {EXPERT_COPY.retry}
            </Button>
          </div>
        ) : (
          <div className={styles.photoViewerCanvas} style={imageStyle}>
            <Image
              key={selectedPhoto.id}
              src={selectedPhoto.url}
              alt={selectedPhoto.name || COPY.sourceAlt}
              fill
              unoptimized
              draggable={false}
              className={styles.photoImage}
              onLoad={imageLoaded}
              onError={fail}
            />
          </div>
        )}
      </div>
    </div>
  );
}
