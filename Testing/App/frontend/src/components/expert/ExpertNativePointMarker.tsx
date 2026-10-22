import type { ExpertNativePoint } from '@/config/expert';
import { layout } from '@/config/layout';

export function ExpertNativePointMarker({
  point,
  x,
  y,
}: {
  point: ExpertNativePoint;
  x: number;
  y: number;
}) {
  const styles = layout.expertSolution;
  const shape = styles.circleGeometry;

  return (
    <>
      {point.included === true ? (
        <circle cx={x} cy={y} r={shape.haloRadius} className={styles.intervalHalo} />
      ) : null}
      <circle
        cx={x}
        cy={y}
        r={shape.pointRadius}
        strokeWidth={shape.pointStrokeWidth}
        className={
          point.included === null
            ? styles.circleNeutralPoint
            : point.included
              ? styles.intervalIncluded
              : styles.intervalExcluded
        }
      />
    </>
  );
}
