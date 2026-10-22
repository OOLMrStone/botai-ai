import { MathFormula } from '@/components/common/MathFormula';
import type { ExpertUnitCircle as ExpertUnitCircleData } from '@/config/expert';
import { EXPERT_SOLUTION_COPY } from '@/config/expert-solution-layout';
import { layout } from '@/config/layout';
import { buildExpertUnitCircle } from '@/lib/expert-diagram';

export function ExpertUnitCircle({ circle }: { circle: ExpertUnitCircleData }) {
  const styles = layout.expertSolution;
  const geometry = styles.circleGeometry;
  const diagram = buildExpertUnitCircle(circle);

  return (
    <svg
      viewBox={geometry.viewBox}
      role="img"
      aria-label={EXPERT_SOLUTION_COPY.unitCircle}
      className={styles.circle}
    >
      <line
        x1={geometry.axisStart}
        x2={geometry.axisEnd}
        y1={geometry.center.y}
        y2={geometry.center.y}
        strokeWidth={geometry.strokeWidth}
        className={styles.intervalAxis}
      />
      <line
        x1={geometry.center.x}
        x2={geometry.center.x}
        y1={geometry.verticalStart}
        y2={geometry.verticalEnd}
        strokeWidth={geometry.strokeWidth}
        className={styles.intervalAxis}
      />
      <circle
        cx={geometry.center.x}
        cy={geometry.center.y}
        r={geometry.radius}
        strokeWidth={geometry.strokeWidth}
        className={styles.intervalCurve}
      />
      {diagram.arcs.map((arc) => (
        <path
          key={arc.id}
          d={arc.path}
          strokeWidth={arc.selected ? geometry.selectedStrokeWidth : geometry.strokeWidth}
          className={arc.selected ? styles.circleSelectedArc : styles.intervalCurve}
        />
      ))}
      {diagram.points.map((point) => (
        <g key={point.id}>
          {point.selected ? (
            <circle
              cx={point.x}
              cy={point.y}
              r={geometry.haloRadius}
              className={styles.intervalHalo}
            />
          ) : null}
          <circle
            cx={point.x}
            cy={point.y}
            r={geometry.pointRadius}
            strokeWidth={geometry.pointStrokeWidth}
            className={
              !point.hasMarker
                ? styles.circleNeutralPoint
                : point.selected
                  ? styles.intervalIncluded
                  : point.filled
                    ? styles.circleNeutralPoint
                    : styles.intervalExcluded
            }
          />
          <foreignObject
            x={point.labelX}
            y={point.labelY}
            width={geometry.labelBox.width}
            height={geometry.labelBox.height}
          >
            <MathFormula value={point.label} className={styles.circleFormula} />
          </foreignObject>
        </g>
      ))}
      <text {...geometry.axisLabels.x} className={styles.intervalLabel}>
        {geometry.axes.x}
      </text>
      <text {...geometry.axisLabels.y} className={styles.intervalLabel}>
        {geometry.axes.y}
      </text>
    </svg>
  );
}
