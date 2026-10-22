import { MathFormula } from '@/components/common/MathFormula';
import { ExpertNativePointMarker } from '@/components/expert/ExpertNativePointMarker';
import { ExpertNativeDiagramLabel } from '@/components/expert/ExpertNativeDiagramLabel';
import type { ExpertNativeUnitCircle as NativeUnitCircle } from '@/config/expert';
import { EXPERT_SOLUTION_COPY } from '@/config/expert-solution-layout';
import { EXPERT_NATIVE_DIAGRAM_COPY as COPY } from '@/config/expert-native-diagram';
import { layout } from '@/config/layout';
import { buildExpertNativeUnitCircle } from '@/lib/expert-native-diagram';

export function ExpertNativeUnitCircle({ diagram }: { diagram: NativeUnitCircle }) {
  const styles = layout.expertSolution;
  const native = layout.expertNativeDiagram;
  const shape = styles.circleGeometry;
  const rendered = buildExpertNativeUnitCircle(diagram);

  return (
    <span className={native.root}>
      <svg
        viewBox={shape.viewBox}
        role="img"
        aria-label={EXPERT_SOLUTION_COPY.unitCircle}
        className={styles.circle}
      >
        <line
          x1={shape.axisStart}
          x2={shape.axisEnd}
          y1={shape.center.y}
          y2={shape.center.y}
          strokeWidth={shape.strokeWidth}
          className={styles.intervalAxis}
        />
        <line
          x1={shape.center.x}
          x2={shape.center.x}
          y1={shape.verticalStart}
          y2={shape.verticalEnd}
          strokeWidth={shape.strokeWidth}
          className={styles.intervalAxis}
        />
        <circle
          cx={shape.center.x}
          cy={shape.center.y}
          r={shape.radius}
          strokeWidth={shape.strokeWidth}
          className={styles.intervalCurve}
        />
        {rendered.points
          .filter((point) => point.bound)
          .map((point) => (
            <line
              key={point.id}
              x1={shape.center.x}
              y1={shape.center.y}
              x2={point.x}
              y2={point.y}
              strokeWidth={shape.strokeWidth}
              strokeDasharray={styles.numberLine.domainBoundary.strokeDasharray}
              className={native.bound}
            />
          ))}
        {rendered.arcs.map((arc) => (
          <g key={arc.index}>
            <path
              d={arc.path}
              strokeWidth={arc.selected ? shape.selectedStrokeWidth : shape.strokeWidth}
              className={arc.selected ? styles.circleSelectedArc : styles.intervalCurve}
            />
            {arc.sign !== null ? (
              <text
                x={arc.signPosition.x}
                y={arc.signPosition.y}
                textAnchor="middle"
                className={styles.intervalSign}
              >
                {arc.sign}
              </text>
            ) : null}
          </g>
        ))}
        {rendered.points.map((point) => (
          <g key={point.id}>
            <ExpertNativePointMarker point={point} x={point.x} y={point.y} />
            <ExpertNativeDiagramLabel
              value={point.value}
              x={point.labelX}
              y={point.labelY}
              width={shape.labelBox.width}
              height={shape.labelBox.height}
            />
            {point.sign !== null ? (
              <text
                x={point.signPosition.x}
                y={point.signPosition.y}
                textAnchor="middle"
                className={styles.intervalDomainLabel}
              >
                {point.sign}
              </text>
            ) : null}
          </g>
        ))}
        <text {...shape.axisLabels.x} className={styles.intervalLabel}>
          {shape.axes.x}
        </text>
        <text {...shape.axisLabels.y} className={styles.intervalLabel}>
          {shape.axes.y}
        </text>
      </svg>
      {rendered.unknownPoints.length ? (
        <span className={native.unknown}>
          <span>{COPY.unknownAngles}</span>
          <span className={native.unknownValues}>
            {rendered.unknownPoints.map((point) => (
              <MathFormula
                key={point.id}
                value={point.value}
                className={native.unknownValue}
                inline
              />
            ))}
          </span>
        </span>
      ) : rendered.missingArcs ? (
        <span className={native.unknown}>{COPY.unknownArcs}</span>
      ) : null}
    </span>
  );
}
