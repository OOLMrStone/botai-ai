import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const motion = JSON.parse(
  readFileSync(new URL('../src/config/lemur-joy-motion.json', import.meta.url), 'utf8'),
);
const art = JSON.parse(readFileSync(new URL(`../${motion.paths.art}`, import.meta.url), 'utf8'));
const { lemurJoySvg } = await import(new URL('../src/lib/lemur-joy-svg.mjs', import.meta.url));

const SAMPLES = 1200;
const POSITION_TOLERANCE = 0.003;
const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;

  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

function transformMatrix(transform) {
  let matrix = IDENTITY;

  for (const [, name, values] of transform.matchAll(/([a-z]+)\(([^)]*)\)/g)) {
    const numbers = values.trim().split(/[ ,]+/).map(Number);
    let next;

    if (name === 'translate') {
      const [x, y = 0] = numbers;
      next = [1, 0, 0, 1, x, y];
    } else if (name === 'scale') {
      const [x, y = x] = numbers;
      next = [x, 0, 0, y, 0, 0];
    } else if (name === 'rotate') {
      const [degrees, x = 0, y = 0] = numbers;
      const radians = (degrees * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      next = [cosine, sine, -sine, cosine, x - cosine * x + sine * y, y - sine * x - cosine * y];
    } else {
      assert.fail(`Неизвестное преобразование SVG: ${name}`);
    }
    matrix = multiply(matrix, next);
  }

  return matrix;
}

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => match.slice(1)),
  );
}

function cubicExtrema(values) {
  const [a, b, c, d] = values;
  const quadratic = -a + 3 * b - 3 * c + d;
  const linear = 2 * (a - 2 * b + c);
  const constant = b - a;
  const discriminant = linear ** 2 - 4 * quadratic * constant;
  const roots =
    Math.abs(quadratic) < Number.EPSILON
      ? Math.abs(linear) < Number.EPSILON
        ? []
        : [-constant / linear]
      : discriminant < 0
        ? []
        : [
            (-linear - Math.sqrt(discriminant)) / (2 * quadratic),
            (-linear + Math.sqrt(discriminant)) / (2 * quadratic),
          ];

  return [0, 1, ...roots.filter((t) => t > 0 && t < 1)];
}

function cubicPoint(points, t) {
  return [0, 1].map(
    (axis) =>
      (1 - t) ** 3 * points[0][axis] +
      3 * (1 - t) ** 2 * t * points[1][axis] +
      3 * (1 - t) * t ** 2 * points[2][axis] +
      t ** 3 * points[3][axis],
  );
}

function pathSupport(data, matrix) {
  const tokens = data.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g);
  assert.ok(tokens?.length, 'Пустой контур стопы');
  const [a, b, c, d, e, f] = matrix;
  const candidates = [];
  let index = 0;
  let previous;

  while (index < tokens.length) {
    const command = tokens[index++];
    assert.ok(['M', 'C', 'Z'].includes(command), `Неизвестная команда стопы: ${command}`);
    const count = command === 'M' ? 1 : command === 'C' ? 3 : 0;
    const points = [];
    for (let point = 0; point < count; point += 1) {
      const x = Number(tokens[index++]);
      const y = Number(tokens[index++]);
      points.push([a * x + c * y + e, b * x + d * y + f]);
    }
    if (command === 'M') {
      [previous] = points;
      candidates.push(previous);
    } else if (command === 'C') {
      assert.ok(previous?.every(Number.isFinite), 'Кривая стопы должна следовать за M');
      const curve = [previous, ...points];
      candidates.push(
        ...cubicExtrema(curve.map((point) => point[1])).map((t) => cubicPoint(curve, t)),
      );
      previous = points.at(-1);
    }
  }

  return candidates.reduce((lowest, point) => (point[1] > lowest[1] ? point : lowest));
}

function renderedSoles(time) {
  const svg = lemurJoySvg(time, art, motion);
  const stack = [IDENTITY];
  const paws = [];

  // Экстремумы конечных кривых учитывают поворот и отличаются от центров и контрольных точек.
  for (const [tag] of svg.matchAll(/<g\b[^>]*>|<\/g>|<path\b[^>]*\/>/g)) {
    if (tag === '</g>') {
      assert.ok(stack.length > 1, 'Нарушено вложение групп SVG');
      stack.pop();
      continue;
    }
    const attrs = attributes(tag);
    const matrix = multiply(stack.at(-1), transformMatrix(attrs.transform ?? ''));

    if (tag.startsWith('<g')) {
      stack.push(matrix);
    } else if (attrs['data-part'] === 'foot') {
      assert.equal(attrs.fill, art.colors.paw, 'Стопа потеряла тёмную заливку');
      paws.push(pathSupport(attrs.d, matrix));
    }
  }
  assert.equal(stack.length, 1, 'Незакрытая группа SVG');
  assert.equal(paws.length, art.legs.length, 'Потеряны конечные тёмные стопы');

  return paws;
}

test('До прыжка и после посадки подошвы закреплены на полу, включая финальное покачивание', () => {
  const floor = art.floor + art.offset[1];
  const times = new Set([
    ...Array.from({ length: SAMPLES + 1 }, (_, index) => (index * motion.duration) / SAMPLES),
    motion.flight.start,
    motion.flight.end,
    motion.restLoopStart,
    motion.restLoopStart + motion.restPeriod / 2,
    ...motion.qaTimes,
  ]);

  for (const time of times) {
    renderedSoles(time).forEach(([, sole], index) => {
      const label = `${art.legs[index].name}, t=${time.toFixed(4)}, подошва=${sole}`;
      assert.ok(Number.isFinite(sole), label);
      assert.ok(sole <= floor + POSITION_TOLERANCE, `Провал ниже пола: ${label}`);
      if (time <= motion.flight.start || time >= motion.flight.end) {
        assert.ok(Math.abs(sole - floor) <= POSITION_TOLERANCE, `Парение на опоре: ${label}`);
      }
    });
  }
});

test('В середине прыжка обе фактические подошвы отрываются от пола', () => {
  const apex = (motion.flight.start + motion.flight.end) / 2;
  const floor = art.floor + art.offset[1];

  for (const [, sole] of renderedSoles(apex)) {
    assert.ok(floor - sole > motion.flight.height / 2, 'Лапа не оторвалась вместе с корпусом');
  }
});

test('Финальный радостный цикл замкнут и отличается от исходной стойки', () => {
  const rest = lemurJoySvg(motion.restLoopStart, art, motion);

  assert.ok(
    Math.abs(motion.duration - motion.restLoopStart - motion.restPeriod) <=
      Number.EPSILON * motion.duration,
    'Экспорт обрывает цикл покоя',
  );
  assert.ok(
    lemurJoySvg(motion.duration, art, motion) === rest,
    'Не замкнут финальный радостный цикл',
  );
  assert.notEqual(lemurJoySvg(0, art, motion), rest, 'Исходная стойка подменена конечной');
});
