import { pair } from './lemur-svg.mjs';
import geometry from '../config/lemur-geometry.json' with { type: 'json' };

export function ribbon(sample, radius, start, end, count, roundedEnd = false, startCurve = 0) {
  const sides = [[], []];
  for (let i = 0; i <= count; i++) {
    const t = start + ((end - start) * i) / count;
    const center = sample(t);
    const before = sample(Math.max(0, t - geometry.derivativeStep));
    const after = sample(Math.min(1, t + geometry.derivativeStep));
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const scale = radius(t) / Math.hypot(dx, dy);
    sides[0].push([center[0] - dy * scale, center[1] + dx * scale]);
    sides[1].push([center[0] + dy * scale, center[1] - dx * scale]);
  }

  const cap = roundedEnd ? `A ${radius(end)} ${radius(end)} 0 0 0` : 'L';
  const root = startCurve
    ? `Q ${pair(sample(Math.max(0, start - startCurve)))} ${pair(sides[0][0])}`
    : '';
  return `M ${sides[0].map(pair).join(' L ')} ${cap} ${sides[1].reverse().map(pair).join(' L ')} ${root} Z`;
}
