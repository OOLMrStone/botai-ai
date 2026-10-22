import { expertSolutionLayout } from '@/config/expert-solution-layout';

const source = expertSolutionLayout;
const line = source.numberLine;
const circle = source.circleGeometry;

export const EXPERT_NATIVE_DIAGRAM = {
  degreeSuffix: /(?:°|\^\{\\circ\}|\^\\circ)\s*$/,
  degreesPerHalfTurn: 180,
  line: {
    minimumWidth: line.axis.x2 + line.axis.x1,
    pointGap: 112,
    leftPadding: line.axis.x1,
    rightPadding: line.labelBox.width / 2 + line.axis.x1,
    height: line.labelBox.y + line.labelBox.height,
    loopWidth: line.curveAmplitude / 2,
    arrowWidth: 8,
    arrowHeight: 5,
    variableOffset: 10,
    variableLabel: { width: line.labelBox.width / 2, height: line.labelBox.height },
  },
  circle: {
    signRadius: circle.radius - circle.labelBox.height,
    pointSignRadius: circle.radius - circle.pointRadius * 4,
  },
} as const;

export const EXPERT_NATIVE_DIAGRAM_COPY = {
  unknownAngles: 'Не удалось расположить эти углы. Сверь их с оригиналом решения',
  unknownArcs: 'Не удалось построить часть схемы. Сверь границы с оригиналом решения',
} as const;

export const expertNativeDiagramLayout = {
  root: 'flex min-w-0 flex-col gap-3',
  note: 'text-sm leading-relaxed text-muted-foreground',
  line: 'block w-full text-foreground',
  label: source.circleFormula,
  unknown: 'flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground',
  unknownValues: 'flex flex-wrap gap-x-4 gap-y-2',
  unknownValue: 'text-base text-foreground',
  bound: 'stroke-muted-foreground/60',
} as const;
