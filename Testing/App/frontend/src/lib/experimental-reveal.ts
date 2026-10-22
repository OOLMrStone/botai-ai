interface RevealBounds {
  top: number;
  bottom: number;
}

interface RevealPosition {
  target: RevealBounds;
  viewport: RevealBounds;
  scrollTop: number;
  maxScrollTop: number;
}

export function centeredExperimentalScrollTop({
  target,
  viewport,
  scrollTop,
  maxScrollTop,
}: RevealPosition) {
  const targetCenter = (target.top + target.bottom) / 2;
  const viewportCenter = (viewport.top + viewport.bottom) / 2;
  const desiredScrollTop = scrollTop + targetCenter - viewportCenter;

  return Math.min(Math.max(0, maxScrollTop), Math.max(0, desiredScrollTop));
}
