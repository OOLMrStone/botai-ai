import { animationChannel } from './animation-channel.mjs';
import { ribbon } from './lemur-ribbon.mjs';
import { joyTailRadius } from './lemur-joy-motion.mjs';
import { path } from './lemur-svg.mjs';

export function waveTailPoint(t, time, art, motion) {
  const transfer = animationChannel(time - t * motion.tail.tipDelay, motion.channels.tail);
  const points = art.tail.points.map((point, index) =>
    point.map((value, axis) => value + (motion.tail.rightPoints[index][axis] - value) * transfer),
  );

  const point = [0, 1].map(
    (axis) =>
      (1 - t) ** 3 * points[0][axis] +
      3 * (1 - t) ** 2 * t * points[1][axis] +
      3 * (1 - t) * t ** 2 * points[2][axis] +
      t ** 3 * points[3][axis],
  );
  const lean = animationChannel(time, motion.channels.lean);

  // Основание следует за тазом, а свободный кончик сохраняет самостоятельную дугу.
  point[0] += lean * (point[1] - art.floor) * (1 - t) ** 2;

  return point;
}

export function waveTailSvg(time, art, motion) {
  const sample = (t) => waveTailPoint(t, time, art, motion);
  const radius = (t) => joyTailRadius(t, art);
  const bands = art.tail.bands.slice(0, -1).map((start, index) => {
    const color = index % 2 ? art.colors.cream : art.colors.tail;

    return path(
      ribbon(sample, radius, start, art.tail.bands[index + 1], art.tail.samples),
      color,
      `stroke="${color}" stroke-width="${motion.tail.bandOverlap}" stroke-linejoin="round"`,
    );
  });

  return (
    path(ribbon(sample, radius, 0, 1, art.tail.samples, true), art.colors.tail) + bands.join('')
  );
}
