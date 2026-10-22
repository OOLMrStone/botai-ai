import { EXPERT } from '@/config/expert';
import { EXPERT_GEOMETRY_COPY } from '@/config/expert-geometry';
import { EXPERT_UI_COPY } from '@/config/expert-ui';

export const EXPERT_NATIVE_EDITOR = {
  point: { value: '', included: false, sign: null },
  arc: { sign: null, selected: false },
  circleDirection: 'ccw',
  fields: { point: (id: string) => `point.${id}`, variable: 'variable', note: 'note' },
  inclusionOptions: [
    { value: true, label: EXPERT_UI_COPY.pointIncluded },
    { value: false, label: 'Исключена' },
    { value: null, label: 'Без отметки' },
  ],
  infinityOptions: [
    { id: EXPERT.nativeDiagram.infinityEndpoints[0], label: EXPERT_GEOMETRY_COPY.negativeInfinity },
    { id: EXPERT.nativeDiagram.infinityEndpoints[1], label: EXPERT_GEOMETRY_COPY.positiveInfinity },
  ],
} as const;

export const EXPERT_NATIVE_EDITOR_COPY = {
  point: (index: number) => `Точка ${index + 1}`,
  pointValue: (index: number) => `Значение точки ${index + 1}`,
  pointAngle: (index: number) => `Угол точки ${index + 1}`,
  boundary: 'Граница области',
  inclusion: 'Отметка точки',
  note: 'Подпись к прямой',
  fullCircle: 'Полная окружность',
  needCirclePoint: 'Добавь точку, чтобы задать дугу',
  pointLimit: 'Достигнут предел количества точек',
  arcLimit: 'Достигнут предел количества промежутков',
  pointRemovalHint: 'При удалении точки связанные с ней промежутки тоже удалятся',
  unknownAngle:
    'Не удалось определить положение точки. Уточни угол, чтобы увидеть её на окружности',
} as const;
