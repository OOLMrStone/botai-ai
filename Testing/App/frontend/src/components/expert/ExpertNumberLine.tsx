import type { ExpertNumberLine as ExpertNumberLineData } from '@/config/expert';
import { MathFormula } from '@/components/common/MathFormula';
import { EXPERT_COPY } from '@/config/expert';
import { EXPERT_SOLUTION_COPY } from '@/config/expert-solution-layout';
import { layout } from '@/config/layout';
import { buildExpertNumberLine } from '@/lib/expert-diagram';

export function ExpertNumberLine({ axis }: { axis: ExpertNumberLineData }) {
  const styles = layout.expertSolution;
  const geometry = styles.numberLine;
  const diagram = buildExpertNumberLine(axis);

  if (!diagram) return <span className={styles.blockText}>{EXPERT_COPY.errors.geometry}</span>;

  return (
    <span className={styles.diagramViewport}>
      <svg
        viewBox={geometry.viewBox}
        role="img"
        aria-label={EXPERT_SOLUTION_COPY.numberLine}
        className={styles.numberLineSvg}
      >
        <text
          x={diagram.domainLabelX}
          y={geometry.domainLabel.y}
          className={styles.intervalDomainLabel}
        >
          {diagram.domainLabel}
        </text>
        <line {...geometry.axis} className={styles.intervalAxis} />
        <path {...geometry.arrow} fill="none" className={styles.intervalAxis} />
        {diagram.boundaries.map((boundary) => (
          <g key={boundary.value}>
            <line
              {...geometry.domainBoundary}
              x1={boundary.x}
              x2={boundary.x}
              className={styles.intervalAxis}
            />
            {boundary.showLabel ? (
              <text
                x={boundary.x}
                y={geometry.pointLabelY}
                textAnchor="middle"
                className={styles.intervalPointLabel}
              >
                {boundary.value}
              </text>
            ) : null}
          </g>
        ))}
        {diagram.intervals.map((interval) => (
          <g key={interval.id}>
            {interval.sign && interval.sign !== '0' ? (
              <path
                d={interval.curve}
                strokeWidth={geometry.curveWidth}
                className={styles.intervalCurve}
              />
            ) : null}
            {interval.selected ? (
              <line
                x1={interval.start}
                x2={interval.end}
                y1={geometry.axis.y1}
                y2={geometry.axis.y2}
                strokeWidth={geometry.solution.strokeWidth}
                className={styles.intervalSolution}
              />
            ) : null}
            <text
              x={interval.signX}
              y={interval.signY}
              textAnchor="middle"
              className={styles.intervalSign}
            >
              {interval.sign}
            </text>
          </g>
        ))}
        {diagram.points.map((point) => (
          <g key={point.id}>
            {point.selected ? (
              <circle
                cx={point.x}
                cy={geometry.point.cy}
                r={geometry.halo.r}
                className={styles.intervalHalo}
              />
            ) : null}
            {point.hasMarker ? (
              <circle
                cx={point.x}
                {...geometry.point}
                className={
                  point.selected
                    ? styles.intervalIncluded
                    : point.included
                      ? styles.circleNeutralPoint
                      : styles.intervalExcluded
                }
              />
            ) : (
              <line x1={point.x} x2={point.x} {...geometry.tick} className={styles.intervalAxis} />
            )}
            <foreignObject
              x={point.x - geometry.labelBox.width / 2}
              y={geometry.labelBox.y}
              width={geometry.labelBox.width}
              height={geometry.labelBox.height}
            >
              <MathFormula value={point.label} className={styles.circleFormula} />
            </foreignObject>
          </g>
        ))}
        <text {...geometry.axisLabel} className={styles.intervalLabel}>
          {axis.label}
        </text>
      </svg>
    </span>
  );
}
