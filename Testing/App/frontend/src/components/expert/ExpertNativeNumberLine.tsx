import { ExpertRichText } from '@/components/expert/ExpertRichText';
import { ExpertNativePointMarker } from '@/components/expert/ExpertNativePointMarker';
import { ExpertNativeDiagramLabel } from '@/components/expert/ExpertNativeDiagramLabel';
import type { ExpertNativeNumberLine as NativeNumberLine } from '@/config/expert';
import { EXPERT_SOLUTION_COPY } from '@/config/expert-solution-layout';
import { EXPERT_NATIVE_DIAGRAM_COPY as COPY } from '@/config/expert-native-diagram';
import { layout } from '@/config/layout';
import { buildExpertNativeNumberLine } from '@/lib/expert-native-diagram';

export function ExpertNativeNumberLine({ diagram }: { diagram: NativeNumberLine }) {
  const styles = layout.expertSolution;
  const native = layout.expertNativeDiagram;
  const shape = styles.numberLine;
  const rendered = buildExpertNativeNumberLine(diagram);

  return (
    <span className={native.root}>
      {diagram.note ? <ExpertRichText value={diagram.note} className={native.note} /> : null}
      <span className={styles.diagramViewport}>
        <svg
          viewBox={rendered.viewBox}
          role="img"
          aria-label={EXPERT_SOLUTION_COPY.numberLine}
          className={native.line}
          style={{ minWidth: rendered.width }}
        >
          <line {...rendered.axis} className={styles.intervalAxis} />
          <path
            d={rendered.arrow}
            strokeWidth={shape.arrow.strokeWidth}
            fill="none"
            className={styles.intervalAxis}
          />
          {rendered.points
            .filter((point) => point.bound)
            .map((point) => (
              <line
                key={point.id}
                {...shape.domainBoundary}
                x1={point.x}
                x2={point.x}
                className={native.bound}
              />
            ))}
          {rendered.arcs.map((arc) => (
            <g key={arc.index}>
              <path
                d={arc.path}
                strokeWidth={
                  arc.selected && arc.loop ? shape.solution.strokeWidth : shape.curveWidth
                }
                className={
                  arc.selected && arc.loop ? styles.circleSelectedArc : styles.intervalCurve
                }
              />
              {arc.selected && !arc.loop ? (
                <line
                  x1={arc.start}
                  x2={arc.end}
                  y1={shape.axis.y1}
                  y2={shape.axis.y1}
                  strokeWidth={shape.solution.strokeWidth}
                  className={styles.intervalSolution}
                />
              ) : null}
              {arc.sign !== null ? (
                <text
                  x={arc.signX}
                  y={arc.signY}
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
              {point.bound && point.included === null ? null : (
                <ExpertNativePointMarker point={point} x={point.x} y={shape.axis.y1} />
              )}
              <ExpertNativeDiagramLabel
                value={point.value}
                x={point.x - shape.labelBox.width / 2}
                y={shape.labelBox.y}
                width={shape.labelBox.width}
                height={shape.labelBox.height}
              />
            </g>
          ))}
          <ExpertNativeDiagramLabel value={diagram.variable} {...rendered.variable} />
        </svg>
      </span>
      {rendered.missingArcs ? <span className={native.unknown}>{COPY.unknownArcs}</span> : null}
    </span>
  );
}
