import {
  EXPERT,
  type ExpertNativeArc,
  type ExpertNativeDiagram,
  type ExpertNativePoint,
} from '@/config/expert';
import {
  EXPERT_NATIVE_EDITOR as CONFIG,
  EXPERT_NATIVE_EDITOR_COPY as COPY,
} from '@/config/expert-native-editor';

export function updateNativePoint(
  diagram: ExpertNativeDiagram,
  id: string,
  patch: Partial<Omit<ExpertNativePoint, 'id'>>,
) {
  return {
    ...diagram,
    points: diagram.points.map((point) => (point.id === id ? { ...point, ...patch } : point)),
  };
}

export function setNativePointBoundary(diagram: ExpertNativeDiagram, id: string, bound: boolean) {
  const point = diagram.points.find((item) => item.id === id);
  if (!point) return diagram;

  return updateNativePoint(diagram, id, {
    bound,
    included: !bound && point.included === null ? false : point.included,
  });
}

export function addNativePoint(diagram: ExpertNativeDiagram, id: string) {
  if (
    diagram.points.length >= EXPERT.nativeDiagram.maxPoints ||
    diagram.points.some((point) => point.id === id)
  )
    return diagram;

  return { ...diagram, points: [...diagram.points, { ...CONFIG.point, id }] };
}

export function removeNativePoint(diagram: ExpertNativeDiagram, id: string): ExpertNativeDiagram {
  const points = diagram.points.filter((point) => point.id !== id);
  const keepArc = (arc: ExpertNativeArc) => arc.from !== id && arc.to !== id;

  return diagram.kind === 'number_line_v2'
    ? { ...diagram, points, arcs: diagram.arcs.filter(keepArc) }
    : { ...diagram, points, arcs: diagram.arcs.filter(keepArc) };
}

export function updateNativeArc(
  diagram: ExpertNativeDiagram,
  index: number,
  patch: Partial<ExpertNativeArc>,
): ExpertNativeDiagram {
  if (diagram.kind === 'number_line_v2')
    return {
      ...diagram,
      arcs: diagram.arcs.map((arc, position) => (position === index ? { ...arc, ...patch } : arc)),
    };

  return {
    ...diagram,
    arcs: diagram.arcs.map((arc, position) => {
      if (position !== index) return arc;
      const next = { ...arc, ...patch };
      return { ...next, full_circle: next.from === next.to };
    }),
  };
}

export function setNativeArcDirection(
  diagram: ExpertNativeDiagram,
  index: number,
  direction: 'cw' | 'ccw',
): ExpertNativeDiagram {
  return diagram.kind === 'unit_circle_v2'
    ? {
        ...diagram,
        arcs: diagram.arcs.map((arc, position) =>
          position === index ? { ...arc, direction } : arc,
        ),
      }
    : diagram;
}

export function removeNativeArc(diagram: ExpertNativeDiagram, index: number): ExpertNativeDiagram {
  return diagram.kind === 'number_line_v2'
    ? { ...diagram, arcs: diagram.arcs.filter((_, position) => position !== index) }
    : { ...diagram, arcs: diagram.arcs.filter((_, position) => position !== index) };
}

export function addNativeArc(diagram: ExpertNativeDiagram): ExpertNativeDiagram {
  if (diagram.arcs.length >= EXPERT.nativeDiagram.maxArcs) return diagram;
  if (diagram.kind === 'number_line_v2') {
    const from = diagram.points[0]?.id ?? EXPERT.nativeDiagram.infinityEndpoints[0];
    const to = diagram.points[1]?.id ?? EXPERT.nativeDiagram.infinityEndpoints[1];
    return { ...diagram, arcs: [...diagram.arcs, { ...CONFIG.arc, from, to }] };
  }

  const from = diagram.points[0]?.id;
  if (!from) return diagram;
  const to = diagram.points[1]?.id ?? from;
  return {
    ...diagram,
    arcs: [
      ...diagram.arcs,
      { ...CONFIG.arc, from, to, direction: CONFIG.circleDirection, full_circle: from === to },
    ],
  };
}

export function nativeEndpointOptions(diagram: ExpertNativeDiagram) {
  const points = diagram.points.map((point, index) => ({
    id: point.id,
    label: COPY.point(index),
    formula: point.value,
  }));
  if (diagram.kind === 'unit_circle_v2') return points;

  const [negative, positive] = CONFIG.infinityOptions;
  return [{ ...negative, formula: null }, ...points, { ...positive, formula: null }];
}
