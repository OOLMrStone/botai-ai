'use client';

import { useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from 'react';
import type { ExpertTask } from '@/config/expert';
import { EXPERT_UI, EXPERT_UI_COPY } from '@/config/expert-ui';
import { useGestureSurfaceGuard } from '@/hooks/use-gesture-surface-guard';
import { expertSources } from '@/lib/expert-source';

export function useExpertPhotoViewer(
  task: Pick<ExpertTask, 'sourceImages' | 'sourceImage'>,
  fitWidth = false,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ url: string; value: number }>({
    url: '',
    value: EXPERT_UI.photoZoom.min,
  });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [imageSize, setImageSize] = useState<{ url: string; width: number; height: number } | null>(
    null,
  );
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const photos = expertSources(task);
  const photo = photos.find((candidate) => candidate.id === selectedId) ?? photos[0] ?? null;
  const scale = zoom.url === photo?.url ? zoom.value : EXPERT_UI.photoZoom.min;
  const percent = scale * EXPERT_UI.photoZoom.percent;

  useGestureSurfaceGuard(surfaceRef);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !fitWidth) return;

    const observer = new ResizeObserver(([entry]) => {
      setViewportWidth(entry.contentRect.width);
    });
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [fitWidth, photo?.url]);

  function imageLoaded(event: SyntheticEvent<HTMLImageElement>) {
    if (!photo) return;

    const image = event.currentTarget;
    setImageSize({ url: photo.url, width: image.naturalWidth, height: image.naturalHeight });
  }

  const imageHeight =
    fitWidth &&
    viewportWidth > 0 &&
    imageSize?.url === photo?.url &&
    imageSize &&
    imageSize.width > 0
      ? (viewportWidth * scale * imageSize.height) / imageSize.width
      : `${percent}%`;

  function selectPhoto(id: string) {
    setSelectedId(id);
    setZoom({ url: '', value: EXPERT_UI.photoZoom.min });
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  }

  function changeZoom(value: number) {
    if (!photo) return;
    setZoom({
      url: photo.url,
      value: Math.min(EXPERT_UI.photoZoom.max, Math.max(EXPERT_UI.photoZoom.min, value)),
    });
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || scale === EXPERT_UI.photoZoom.min) return;

    const viewport = event.currentTarget;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    event.currentTarget.scrollLeft = drag.left + drag.x - event.clientX;
    event.currentTarget.scrollTop = drag.top + drag.y - event.clientY;
  }

  function stopPan(event: PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return {
    photos,
    photo,
    originalDocument: photo && 'originalDocument' in photo ? photo.originalDocument : undefined,
    selectPhoto,
    surfaceRef,
    viewportRef,
    imageStyle: { width: `${percent}%`, height: imageHeight },
    imageLoaded,
    zoomLabel: EXPERT_UI_COPY.sourceZoom(percent),
    canZoomIn: scale < EXPERT_UI.photoZoom.max,
    canZoomOut: scale > EXPERT_UI.photoZoom.min,
    zoomIn: () => changeZoom(scale + EXPERT_UI.photoZoom.step),
    zoomOut: () => changeZoom(scale - EXPERT_UI.photoZoom.step),
    resetZoom: () => changeZoom(EXPERT_UI.photoZoom.min),
    startPan,
    pan,
    stopPan,
    failed: photo !== null && failedUrl === photo.url,
    fail: () => setFailedUrl(photo?.url ?? null),
    retry: () => setFailedUrl(null),
  };
}

export type ExpertPhotoViewerModel = ReturnType<typeof useExpertPhotoViewer>;
