import { Popover } from '@base-ui/react/popover';
import { Download, ExternalLink, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { EXPERT_SOURCE_COPY } from '@/config/expert-source-layout';
import { EXPERT_UI_COPY as COPY } from '@/config/expert-ui';
import { INTEGRATION } from '@/config/integration';
import { layout } from '@/config/layout';
import type { ExpertPhotoViewerModel } from '@/hooks/use-expert-photo-viewer';

function SourceControls({ viewer, inPane }: { viewer: ExpertPhotoViewerModel; inPane: boolean }) {
  const styles = layout.expert;
  const resetLabel = inPane ? EXPERT_SOURCE_COPY.fitWidth : COPY.sourceZoomReset;

  return (
    <div className={styles.photoViewerToolbar}>
      {viewer.photos.length > 1 ? (
        <div className={styles.photoViewerPages} role="group" aria-label={EXPERT_SOURCE_COPY.files}>
          {viewer.photos.map((photo, index) => (
            <Button
              type="button"
              key={photo.id}
              variant={photo.id === viewer.photo?.id ? 'default' : 'ghost'}
              size="icon-compact"
              className={photo.id === viewer.photo?.id ? undefined : styles.photoViewerPage}
              aria-label={EXPERT_SOURCE_COPY.file(index, viewer.photos.length)}
              aria-pressed={photo.id === viewer.photo?.id}
              onClick={() => viewer.selectPhoto(photo.id)}
            >
              {COPY.sourcePageNumber(index)}
            </Button>
          ))}
        </div>
      ) : !inPane ? (
        <span className={styles.caption}>{COPY.sourceOriginal}</span>
      ) : null}
      <div className={styles.photoViewerActions}>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={COPY.sourceZoomOut}
          title={COPY.sourceZoomOut}
          disabled={!viewer.canZoomOut || viewer.failed}
          onClick={viewer.zoomOut}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="compact"
          className={styles.photoViewerScale}
          aria-label={resetLabel}
          title={resetLabel}
          disabled={!viewer.canZoomOut || viewer.failed}
          onClick={viewer.resetZoom}
        >
          {viewer.zoomLabel}
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={COPY.sourceZoomIn}
          title={COPY.sourceZoomIn}
          disabled={!viewer.canZoomIn || viewer.failed}
          onClick={viewer.zoomIn}
        >
          <Plus aria-hidden="true" />
        </Button>
        {viewer.originalDocument ? (
          <Button
            variant="ghost"
            size="icon-compact"
            nativeButton={false}
            className={styles.photoExternalAction}
            aria-label={EXPERT_SOURCE_COPY.downloadPdf}
            title={EXPERT_SOURCE_COPY.downloadPdf}
            render={
              <a
                href={viewer.originalDocument.downloadUrl}
                download={viewer.originalDocument.name}
                type={INTEGRATION.pdfType}
              />
            }
          >
            <Download aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-compact"
          nativeButton={false}
          className={styles.photoExternalAction}
          aria-label={EXPERT_SOURCE_COPY.openFile}
          title={EXPERT_SOURCE_COPY.openFile}
          render={<a href={viewer.photo?.url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function ExpertSourceToolbar({
  viewer,
  inPane,
  onCollapse,
}: {
  viewer: ExpertPhotoViewerModel;
  inPane: boolean;
  onCollapse?: () => void;
}) {
  const styles = layout.expertSource;

  if (!inPane) return <SourceControls viewer={viewer} inPane={false} />;

  return (
    <div className={styles.paneChrome}>
      <div className={styles.paneHeader}>
        <ScreenHeading
          title={
            <>
              <span className={styles.paneShortLabel}>{EXPERT_SOURCE_COPY.shortTitle}</span>
              <span className={styles.paneFullLabel}>{COPY.sourceOriginal}</span>
            </>
          }
          as="h2"
          variant="task"
        />
        <div className={styles.paneHeaderActions}>
          <div className={styles.mobileControls}>
            <Popover.Root>
              <Popover.Trigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    aria-label={EXPERT_SOURCE_COPY.viewControls}
                  />
                }
              >
                <SlidersHorizontal aria-hidden="true" />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  side="bottom"
                  align="end"
                  sideOffset={styles.controls.sideOffset}
                  collisionPadding={styles.controls.collisionPadding}
                  className={styles.controlsPositioner}
                >
                  <Popover.Popup
                    aria-label={EXPERT_SOURCE_COPY.viewControls}
                    className={styles.controlsPopover}
                  >
                    <SourceControls viewer={viewer} inPane />
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </div>
          {onCollapse ? (
            <Button variant="ghost" size="compact" onClick={onCollapse}>
              {EXPERT_SOURCE_COPY.collapse}
            </Button>
          ) : null}
        </div>
      </div>
      <div className={styles.paneToolbar}>
        <SourceControls viewer={viewer} inPane />
      </div>
    </div>
  );
}
