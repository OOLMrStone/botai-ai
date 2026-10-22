import { MathFormula } from '@/components/common/MathFormula';
import { layout } from '@/config/layout';

export function ExpertNativeDiagramLabel({
  value,
  x,
  y,
  width,
  height,
}: {
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <MathFormula value={value} className={layout.expertNativeDiagram.label} />
    </foreignObject>
  );
}
