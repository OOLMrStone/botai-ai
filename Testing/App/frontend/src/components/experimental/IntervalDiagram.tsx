import { EXPERIMENTAL_COPY } from '@/config/experimental';
import { layout } from '@/config/layout';

export function IntervalDiagram() {
  const styles = layout.experimentalSolution;
  const geometry = styles.intervalGeometry;
  const copy = EXPERIMENTAL_COPY.solution;

  return (
    <svg
      viewBox={geometry.viewBox}
      role="img"
      aria-label={copy.intervalLabel}
      className={styles.interval}
    >
      <text {...geometry.domainLabel} className={styles.intervalDomainLabel}>
        {copy.intervalDomain}
      </text>
      <line {...geometry.axis} className={styles.intervalAxis} />
      <line {...geometry.domainBoundary} className={styles.intervalAxis} />
      <path {...geometry.arrow} fill="none" className={styles.intervalAxis} />
      {geometry.curves.map((curve) => (
        <path
          key={curve.d}
          d={curve.d}
          strokeWidth={geometry.curveWidth}
          className={styles.intervalCurve}
        />
      ))}
      <line {...geometry.solution} className={styles.intervalSolution} />
      <circle {...geometry.halo} className={styles.intervalHalo} />
      {geometry.signs.map((sign) => (
        <text
          key={sign.x}
          x={sign.x}
          y={sign.y}
          textAnchor="middle"
          className={styles.intervalSign}
        >
          {sign.positive ? copy.plus : copy.minus}
        </text>
      ))}
      {geometry.ticks.map((tick) => (
        <g key={tick.label}>
          {tick.included || tick.excluded ? (
            <circle
              cx={tick.x}
              {...geometry.point}
              className={tick.included ? styles.intervalIncluded : styles.intervalExcluded}
            />
          ) : (
            <line x1={tick.x} x2={tick.x} {...geometry.tick} className={styles.intervalAxis} />
          )}
          <text
            x={tick.x}
            y={geometry.pointLabelY}
            textAnchor="middle"
            className={styles.intervalPointLabel}
          >
            {tick.label}
          </text>
        </g>
      ))}
      <text {...geometry.axisLabel} className={styles.intervalLabel}>
        {copy.axisLabel}
      </text>
    </svg>
  );
}
