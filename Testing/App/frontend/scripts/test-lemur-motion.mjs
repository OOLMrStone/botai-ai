import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = JSON.parse(
  readFileSync(new URL('../src/config/lemur-motion.json', import.meta.url), 'utf8'),
);
const { blinkAmount, bodyPose, footPose, headPose, legContour, legPath, tailPoint } = await import(
  new URL('../src/lib/lemur-continuous-motion.mjs', import.meta.url)
);
const { lemurFrameSvg } = await import(new URL('../src/lib/lemur-frame-svg.mjs', import.meta.url));

const EPSILON = 1e-6;
const DERIVATIVE_STEP = 1e-3;
const POSITION_TOLERANCE = 0.001;
const VELOCITY_TOLERANCE = 0.01;
const SAMPLES = 1200;
const CURVE_SAMPLES = 160;
const MINIMUM_VISIBLE_LIFT = 7;
const MINIMUM_BEND_DISPLACEMENT = 1;
const MINIMUM_VOLUME_RATIO = 0.9;
const PROXIMAL_SECTIONS = [0.2, 0.3, 0.4];
const VOLUME_SAMPLES = 80;
const FRONT_SHAFT_SECTIONS = [0.4, 0.5, 0.6, 0.7, 0.8];
const FRONT_ELBOW_JOINS = [2, 6];
const EXTRA_JOIN_ANGLE_DEGREES = 5;
const APPROVED_V11_SHAPES = '501146bf4da09baae9ff6fdbb218ad2d48c180b6ec722b5685e546fb3d806ada';
const APPROVED_GEOMETRY = {
  hind: 'daf51385a56b3f2a31b7489d80d95f0c7d78ca0575f3a19b3150f465a414493c',
  front: '712c806175d6439dfa53a93496ee0bbecf8f9b3e27fc96501a50bf7e9ab5a99e',
};

function globalPhase(local, leg) {
  const side = leg.far ? 'far' : 'near';
  const lag = leg.shape === 'front' ? config.leg.frontPhaseLag[side] : 0;

  return local + config.leg.sidePhaseOffset[side] + lag - config.phaseOffset;
}

function wrapped(phase) {
  return ((phase % 1) + 1) % 1;
}

function contourCommands(path) {
  const tokens = path.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g);
  assert.ok(tokens?.length, 'Пустой контур');
  const commands = [];
  let index = 0;

  while (index < tokens.length) {
    const name = tokens[index++];
    assert.ok(['M', 'C', 'Z'].includes(name), `Неизвестная команда контура ${name}`);
    const count = name === 'M' ? 1 : name === 'C' ? 3 : 0;
    const points = [];
    for (let point = 0; point < count; point += 1) {
      const x = Number(tokens[index++]);
      const y = Number(tokens[index++]);
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `Некорректная точка ${name}`);
      points.push([x, y]);
    }
    commands.push({ name, points });
  }
  return commands;
}

function cubicPoint(points, progress) {
  const inverse = 1 - progress;
  const weights = [
    inverse ** 3,
    3 * inverse ** 2 * progress,
    3 * inverse * progress ** 2,
    progress ** 3,
  ];

  return [0, 1].map((axis) =>
    points.reduce((sum, point, index) => sum + point[axis] * weights[index], 0),
  );
}

function renderedCommands(phase, leg, part = 'silhouette') {
  return contourCommands(legPath(phase, leg, config, part));
}

function joinAngle(commands, index) {
  const incoming = commands[index].points;
  const outgoing = commands[index + 1].points;
  const end = incoming[2];
  const before = end.map((value, axis) => value - incoming[1][axis]);
  const after = outgoing[0].map((value, axis) => value - end[axis]);
  assert.ok(Math.hypot(...before) > 0 && Math.hypot(...after) > 0, 'Вырожденный стык кривых');

  return (
    (Math.abs(
      Math.atan2(
        before[0] * after[1] - before[1] * after[0],
        before[0] * after[0] + before[1] * after[1],
      ),
    ) *
      180) /
    Math.PI
  );
}

function sampledContour(commands) {
  const samples = [];
  let current;
  let beginning;

  // Измеряем конечные SVG-кривые, а не исходные точки до нелинейного отображения.
  for (const { name, points: transformed } of commands) {
    if (name === 'M') {
      [current] = transformed;
      beginning = current;
      samples.push(current);
    } else if (name === 'C') {
      assert.ok(current, 'Кривая должна начинаться после M');
      for (let index = 1; index <= CURVE_SAMPLES; index += 1) {
        samples.push(cubicPoint([current, ...transformed], index / CURVE_SAMPLES));
      }
      current = transformed[2];
    } else {
      assert.ok(beginning, 'Замыкание должно следовать после M');
      current = beginning;
      samples.push(current);
    }
  }
  return samples;
}

function deformedContour(phase, leg, part = 'silhouette') {
  return sampledContour(renderedCommands(phase, leg, part));
}

function soleY(phase, leg) {
  return contourSupport(phase, leg)[1];
}

function cubicExtrema(points, axis) {
  const [a, b, c, d] = points.map((point) => point[axis]);
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

  return [0, 1, ...roots.filter((value) => value > 0 && value < 1)].map((progress) =>
    cubicPoint(points, progress),
  );
}

function contourExtreme(commands, axis = 1, direction = 1) {
  const candidates = [];
  let current;

  for (const { name, points } of commands) {
    if (name === 'M') {
      [current] = points;
      candidates.push(current);
    } else if (name === 'C') {
      candidates.push(...cubicExtrema([current, ...points], axis));
      current = points[2];
    }
  }

  return candidates.reduce((best, point) =>
    point[axis] * direction > best[axis] * direction ? point : best,
  );
}

function contourSupport(phase, leg) {
  return contourExtreme(renderedCommands(phase, leg));
}

function contourArea(points) {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];

      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2,
  );
}

function longitudinalContour(points) {
  const center = [0, 1].map(
    (axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length,
  );
  const centered = points.map((point) => [point[0] - center[0], point[1] - center[1]]);
  const xx = centered.reduce((sum, [x]) => sum + x * x, 0);
  const yy = centered.reduce((sum, [, y]) => sum + y * y, 0);
  const xy = centered.reduce((sum, [x, y]) => sum + x * y, 0);
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const direction = Math.sin(angle) < 0 ? -1 : 1;
  const axis = [Math.cos(angle) * direction, Math.sin(angle) * direction];

  // Главная ось устраняет ложное сжатие от переноса и наклона целой лапы.
  return centered.map(([x, y]) => [-x * axis[1] + y * axis[0], x * axis[0] + y * axis[1]]);
}

function sectionWidth(points, fraction) {
  const top = Math.min(...points.map((point) => point[1]));
  const bottom = Math.max(...points.map((point) => point[1]));
  const level = top + (bottom - top) * fraction;
  const crossings = [];

  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    if (point[1] > level === next[1] > level) return;
    crossings.push(point[0] + ((level - point[1]) * (next[0] - point[0])) / (next[1] - point[1]));
  });
  crossings.sort((left, right) => left - right);
  assert.equal(crossings.length % 2, 0, 'Незамкнутый поперечник');

  return crossings.reduce(
    (width, value, index) => (index % 2 ? width + value - crossings[index - 1] : width),
    0,
  );
}

function curveAt(commands, index, progress) {
  const previous = commands[index - 1].points.at(-1);

  return cubicPoint([previous, ...commands[index].points], progress);
}

function materialSection(reference, height) {
  const crossings = [];
  reference.forEach(({ name, points }, index) => {
    if (name !== 'C') return;
    const start = reference[index - 1].points.at(-1);
    if (start[1] > height === points[2][1] > height) return;
    let lower = 0;
    let upper = 1;
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const middle = (lower + upper) / 2;
      if (curveAt(reference, index, middle)[1] > height === start[1] > height) lower = middle;
      else upper = middle;
    }
    crossings.push({ index, progress: (lower + upper) / 2 });
  });
  assert.equal(crossings.length, 2, `Сечение исходной лапы y=${height} должно иметь две границы`);

  return crossings;
}

function sectionCenter(reference, actual, height, subdivisions) {
  const points = materialSection(reference, height).map(({ index, progress }) => {
    const segment = Math.min(subdivisions - 1, Math.floor(progress * subdivisions));

    return curveAt(
      actual,
      (index - 1) * subdivisions + segment + 1,
      progress * subdivisions - segment,
    );
  });

  return [0, 1].map((axis) => (points[0][axis] + points[1][axis]) / 2);
}

function anatomicalWidth(reference, actual, polygon, height, subdivisions = 1) {
  const center = sectionCenter(reference, actual, height, subdivisions);
  const before = sectionCenter(reference, actual, height - 1, subdivisions);
  const after = sectionCenter(reference, actual, height + 1, subdivisions);
  const tangent = after.map((value, axis) => value - before[axis]);
  const length = Math.hypot(...tangent);
  assert.ok(length > 0, 'Ось лапы не должна вырождаться');
  const axis = tangent.map((value) => value / length);
  const projected = polygon.map(([x, y]) => [
    -(x - center[0]) * axis[1] + (y - center[1]) * axis[0],
    (x - center[0]) * axis[0] + (y - center[1]) * axis[1],
  ]);
  const intersections = [];
  projected.forEach((point, index) => {
    const next = projected[(index + 1) % projected.length];
    if (point[1] > 0 === next[1] > 0) return;
    intersections.push(point[0] - (point[1] * (next[0] - point[0])) / (next[1] - point[1]));
  });
  intersections.sort((left, right) => left - right);
  for (let index = 0; index < intersections.length; index += 2) {
    if (intersections[index] <= 0 && intersections[index + 1] >= 0) {
      return intersections[index + 1] - intersections[index];
    }
  }
  assert.fail(`Ось y=${height} вышла за пределы анатомического сечения`);
}

function close(actual, expected, tolerance = POSITION_TOLERANCE, label = '') {
  assert.ok(Number.isFinite(actual), `${label}: ${actual} не конечное число`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual}, ожидалось ${expected}, допуск ${tolerance}`,
  );
}

function velocityAt(sample, phase, direction) {
  const values = Array.from({ length: 5 }, (_, index) =>
    sample(phase + direction * DERIVATIVE_STEP * index),
  );

  // Четвёртый порядок устраняет погрешность усечения, а отдельный шаг подавляет шум вложенных производных.
  const weights = [-25, 48, -36, 16, -3];

  return values[0].map(
    (_, axis) =>
      (direction * values.reduce((sum, entry, index) => sum + entry[axis] * weights[index], 0)) /
      (12 * DERIVATIVE_STEP),
  );
}

function continuousAt(sample, phase, label) {
  const limit = (direction) => {
    const first = sample(phase + direction * EPSILON);
    const second = sample(phase + direction * EPSILON * 2);
    const third = sample(phase + direction * EPSILON * 3);

    // Односторонний предел отличает скачок от быстрого, но непрерывного движения.
    return first.map((value, index) => 3 * value - 3 * second[index] + third[index]);
  };
  const before = limit(-1);
  const at = sample(phase);
  const after = limit(1);
  const leftVelocity = velocityAt(sample, phase, -1);
  const rightVelocity = velocityAt(sample, phase, 1);

  at.forEach((value, index) => {
    close(before[index], value, POSITION_TOLERANCE, `${label}, координата ${index} слева`);
    close(after[index], value, POSITION_TOLERANCE, `${label}, координата ${index} справа`);
    close(
      leftVelocity[index],
      rightVelocity[index],
      VELOCITY_TOLERANCE,
      `${label}, скорость ${index}`,
    );
  });
}

function footCoordinates(phase, leg) {
  const { x, y, lift, angle, toeAngle, contact } = footPose(phase, leg, config);

  return [x, y, lift, angle, toeAngle, contact.x, contact.y];
}

test('Одобренные формы лап, сгибы и параметры деформации v11 остаются неизменными', () => {
  const signature = createHash('sha256').update(JSON.stringify(config.legShapes)).digest('hex');
  assert.equal(signature, APPROVED_V11_SHAPES, 'Изменена одобренная геометрия v11');
  for (const [name, expected] of Object.entries(APPROVED_GEOMETRY)) {
    const shape = config.legShapes[name];
    const paths = [shape.silhouette, shape.pawPath];
    const geometry = paths.map((path) =>
      contourCommands(path).flatMap(({ name, points }) => [name, ...points.flat()]),
    );

    // Фиксируем одобренный рисунок без зависимости от пробелов и записи дробей SVG.
    const signature = createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
    assert.equal(signature, expected, `${name}: изменена одобренная пользователем геометрия`);
  }
});

test('Передняя лапа сохраняет полноту середины и предплечья во всех фазах', () => {
  const count = config.fps * config.duration;
  const reference = contourCommands(config.legShapes.front.silhouette);
  const original = sampledContour(reference);
  const top = Math.min(...original.map((point) => point[1]));
  const bottom = Math.max(...original.map((point) => point[1]));
  const sections = FRONT_SHAFT_SECTIONS.map((fraction) => {
    const height = top + (bottom - top) * fraction;

    return { fraction, height, width: anatomicalWidth(reference, reference, original, height) };
  });

  for (const leg of config.legs.filter((entry) => entry.shape === 'front')) {
    for (let index = 0; index < count; index += 1) {
      const phase = index / count;
      const actual = renderedCommands(phase, leg);
      const polygon = sampledContour(actual);
      const unwarped = contourCommands(legContour(phase, leg, config));
      const unwarpedPolygon = sampledContour(unwarped);

      // Сравниваем реальные единицы поперёк локальной оси, без деформированного эталона или scale.
      for (const { fraction, height, width } of sections) {
        const actualWidth = anatomicalWidth(
          reference,
          actual,
          polygon,
          height,
          config.leg.contourSubdivisions,
        );
        const ratio = actualWidth / width;
        assert.ok(
          ratio >= MINIMUM_VOLUME_RATIO,
          `${leg.name}, фаза ${phase}, сечение ${fraction}: ширина ${(ratio * 100).toFixed(1)}% исходной формы`,
        );
        const bendWidth = anatomicalWidth(reference, unwarped, unwarpedPolygon, height);
        assert.ok(
          actualWidth <= bendWidth * (2 - MINIMUM_VOLUME_RATIO),
          `${leg.name}, фаза ${phase}, сечение ${fraction}: деформация раздула принятый сгиб до ${((actualWidth / bendWidth) * 100).toFixed(1)}%`,
        );
      }
    }
  }
});

test('Видимые стыки переднего локтя не получают острого перелома при сгибании', () => {
  const count = config.fps * config.duration;
  const front = config.legShapes.front;
  const referenceConfig = {
    ...config,
    legShapes: {
      ...config.legShapes,
      front: {
        ...front,
        articulation: {
          ...front.articulation,
          shapes: Object.fromEntries(
            Object.keys(front.articulation.shapes).map((name) => [
              name,
              { silhouette: front.silhouette },
            ]),
          ),
        },
      },
    },
  };

  for (const leg of config.legs.filter((entry) => entry.shape === 'front')) {
    for (let index = 0; index < count; index += 1) {
      const phase = index / count;
      const baseline = contourCommands(legPath(phase, leg, referenceConfig));
      const actual = renderedCommands(phase, leg);

      // Два стыка ограничивают видимый локоть; плечо под корпусом и округлая стопа не входят.
      for (const join of FRONT_ELBOW_JOINS) {
        const renderedJoin = join * config.leg.contourSubdivisions;
        const angle = joinAngle(actual, renderedJoin);
        const allowed = joinAngle(baseline, renderedJoin) + EXTRA_JOIN_ANGLE_DEGREES;
        assert.ok(
          angle <= allowed,
          `${leg.name}, фаза ${phase}, стык ${join}: перелом ${angle.toFixed(1)}°, допустимо ${allowed.toFixed(1)}°`,
        );
      }
    }
  }
});

test('Наружный задний контур соединяется со стопой без костлявого углового выступа', () => {
  const sourceJoin = 2;
  const original = contourCommands(config.legShapes.hind.silhouette);
  const allowed = joinAngle(original, sourceJoin) + EXTRA_JOIN_ANGLE_DEGREES;

  for (const leg of config.legs.filter((entry) => entry.shape === 'hind')) {
    const count = config.fps * config.duration;
    for (let index = 0; index < count; index += 1) {
      const phase = index / count;
      const angle = joinAngle(
        renderedCommands(phase, leg),
        sourceJoin * config.leg.contourSubdivisions,
      );
      assert.ok(
        angle <= allowed,
        `${leg.name}, фаза ${phase}: наружный стык над стопой ${angle.toFixed(2)}°, допустимо ${allowed.toFixed(2)}°`,
      );
    }
  }
});

test('Стопы непрерывны по положению и скорости при отрыве, касании и повторе цикла', () => {
  for (const leg of config.legs) {
    const sample = (phase) => footCoordinates(phase, leg);

    for (const boundary of [
      globalPhase(0, leg),
      globalPhase(config.stance, leg),
      ...config.leg.toeRoll.keys.map(([local]) => globalPhase(local, leg)),
      0,
      1,
    ]) {
      continuousAt(sample, boundary, `${leg.name}, фаза ${boundary}`);
    }
    sample(0).forEach((value, index) => close(value, sample(1)[index]));
  }
});

test('Весь цикл имеет минимум две опоры, включая моменты смены контактов', () => {
  const transitions = config.legs
    .flatMap((leg) => [wrapped(globalPhase(0, leg)), wrapped(globalPhase(config.stance, leg))])
    .sort((left, right) => left - right);
  const phases = transitions.flatMap((phase, index) => {
    const next = transitions[index + 1] ?? transitions[0] + 1;

    return [phase - EPSILON, phase, phase + EPSILON, (phase + next) / 2];
  });

  // Между событиями касания и отрыва число опор не меняется.
  for (const phase of phases) {
    const supported = config.legs.filter((leg) => footPose(phase, leg, config).grounded);
    assert.ok(supported.length >= 2, `Фаза ${phase}: только ${supported.length} опор`);
  }
});

test('Передняя лапа каждой стороны запаздывает по заданному ритму, задержки сторон различаются', () => {
  close(wrapped(config.leg.sidePhaseOffset.far - config.leg.sidePhaseOffset.near), 0.5);
  assert.ok(config.leg.frontPhaseLag.near > 0);
  assert.ok(config.leg.frontPhaseLag.far > config.leg.frontPhaseLag.near);
  for (const far of [false, true]) {
    const pair = config.legs.filter((leg) => leg.far === far);
    assert.equal(pair.length, 2);
    const hind = pair.find((leg) => leg.shape === 'hind');
    const front = pair.find((leg) => leg.shape === 'front');
    assert.ok(hind && front);
    const lag = config.leg.frontPhaseLag[far ? 'far' : 'near'];
    let differentContacts = 0;

    for (let index = 0; index < SAMPLES; index += 1) {
      // Середины отсчётов не совпадают с границами grounded из-за округления float.
      const phase = (index + 0.5) / SAMPLES;
      const rearPose = footPose(phase, hind, config);
      const delayedPose = footPose(phase + lag, front, config);
      assert.equal(rearPose.grounded, delayedPose.grounded);
      close(
        rearPose.lift / config.leg.travelByShape.hind.lift,
        delayedPose.lift / config.leg.travelByShape.front.lift,
      );
      if (rearPose.grounded !== footPose(phase, front, config).grounded) differentContacts += 1;
    }
    assert.ok(differentContacts > 0, 'Запаздывание не должно оставлять лапы синхронными');

    // Контакт проверяется по нарисованной подошве, а не только по флагу grounded.
    for (const leg of pair) {
      const planted = soleY(globalPhase(config.stance / 2, leg), leg);
      const lifted = soleY(globalPhase(config.stance + (1 - config.stance) / 2, leg), leg);
      assert.ok(
        planted - lifted > MINIMUM_VISIBLE_LIFT,
        `${leg.name}: нарисованная подошва не поднимается вместе с парой`,
      );
    }
  }
});

test('Реальная точка опоры идёт назад с общей постоянной скоростью, включая перекат на носок', () => {
  const expectedSpeed = -config.stride / (config.stance * config.duration);

  for (const leg of config.legs) {
    const planted = contourSupport(globalPhase(config.stance / 2, leg), leg);
    for (let index = 1; index < 40; index += 1) {
      const phase = globalPhase((index * config.stance) / 40, leg);
      const foot = footPose(phase, leg, config);
      const actual = contourSupport(phase, leg);
      const speed = velocityAt((time) => contourSupport(time, leg), phase, 1);

      assert.equal(foot.grounded, true);
      close(foot.lift, 0);
      close(actual[0], foot.contact.x);
      close(actual[1], foot.contact.y);
      close(actual[1], planted[1]);
      close(speed[0] / config.duration, expectedSpeed);
      close(speed[1], 0);
    }
  }
});

test('Перенос поднимает стопу, а не опускает ниже пола; максимум подъёма задан конфигом', () => {
  for (const leg of config.legs) {
    const height = config.leg.travelByShape[leg.shape].lift;
    const ground = config.shadow.y;
    for (let index = 1; index < 100; index += 1) {
      const phase = globalPhase(config.stance + ((1 - config.stance) * index) / 100, leg);
      const foot = footPose(phase, leg, config);

      assert.equal(foot.grounded, false);
      assert.ok(foot.lift > 0 && foot.lift <= height + POSITION_TOLERANCE);
      const actual = soleY(phase, leg);
      assert.ok(
        actual <= ground + POSITION_TOLERANCE,
        `${leg.name}, перенос ${(index / 100).toFixed(2)}: подошва ${actual} ниже пола ${ground}`,
      );
    }
    const middle = globalPhase(config.stance + (1 - config.stance) / 2, leg);
    close(footPose(middle, leg, config).lift, height);
  }
});

test('Передние контуры вынесены вперёд, задние назад; задний перенос ниже переднего', () => {
  assert.ok(config.leg.travelByShape.front.reach > 0);
  assert.ok(config.leg.travelByShape.hind.reach < 0);
  assert.ok(config.leg.travelByShape.hind.lift < config.leg.travelByShape.front.lift);

  for (const leg of config.legs) {
    const shape = config.legShapes[leg.shape];
    const original = contourExtreme(contourCommands(shape.silhouette));
    const planted = contourSupport(globalPhase(config.stance / 2, leg), leg);
    const originalOffset = original[0] - shape.referenceFoot.x;
    close(planted[0] - originalOffset - leg.neutralX, config.leg.travelByShape[leg.shape].reach);
    const lifted = contourSupport(globalPhase(config.stance + (1 - config.stance) / 2, leg), leg);
    close(planted[1] - lifted[1], config.leg.travelByShape[leg.shape].lift);
  }
});

test('Задняя пятка видимо поднимается при перекате, а реальный носок остаётся у пола', () => {
  const keys = config.leg.toeRoll.keys;
  const [pushPhase, pushAngle] = keys.reduce((peak, key) => (key[1] > peak[1] ? key : peak));
  assert.ok(pushAngle > 0);
  close(pushPhase, config.stance);

  for (const leg of config.legs.filter((entry) => entry.shape === config.leg.toeRoll.shape)) {
    const flat = globalPhase(config.stance / 2, leg);
    const push = globalPhase(pushPhase - EPSILON, leg);
    const heel = (phase) => contourExtreme(renderedCommands(phase, leg, 'pawPath'), 0, -1);
    const flatSupport = contourSupport(flat, leg);
    const pushSupport = contourSupport(push, leg);
    const heelRise = pushSupport[1] - heel(push)[1] - (flatSupport[1] - heel(flat)[1]);

    assert.ok(
      heelRise > config.legShapes[leg.shape].pawHeight / 2,
      `${leg.name}: нарисованная пятка почти не поднялась, разница ${heelRise}`,
    );
    close(pushSupport[1], flatSupport[1]);
    for (const [local] of keys.filter(([local]) => local > 0 && local < config.stance)) {
      continuousAt(
        (phase) => contourSupport(phase, leg),
        globalPhase(local, leg),
        `${leg.name}: носок`,
      );
    }
  }
});

for (const leg of config.legs.filter((entry) => entry.far)) {
  test(`${leg.name} сохраняет толщину и площадь принятой ближней лапы в той же фазе`, () => {
    const near = config.legs.find((entry) => !entry.far && entry.shape === leg.shape);
    assert.ok(near, `${leg.name}: отсутствует ближний эталон`);

    // Пользователь одобрил ближние лапы: сравниваем одинаковые позы, а не перенос с опорой.
    for (let index = 0; index < VOLUME_SAMPLES; index += 1) {
      const local = index / VOLUME_SAMPLES;
      const baseline = deformedContour(globalPhase(local, near), near);
      const actual = deformedContour(globalPhase(local, leg), leg);
      const areaRatio = contourArea(actual) / contourArea(baseline);
      const maximumRatio = 2 - MINIMUM_VOLUME_RATIO;
      assert.ok(
        areaRatio >= MINIMUM_VOLUME_RATIO && areaRatio <= maximumRatio,
        `${leg.name}, локальная фаза ${local}: площадь ${(areaRatio * 100).toFixed(1)}% ближней`,
      );
      const baselineSections = longitudinalContour(baseline);
      const sections = longitudinalContour(actual);
      for (const fraction of PROXIMAL_SECTIONS) {
        const ratio = sectionWidth(sections, fraction) / sectionWidth(baselineSections, fraction);
        assert.ok(
          ratio >= MINIMUM_VOLUME_RATIO && ratio <= maximumRatio,
          `${leg.name}, локальная фаза ${local}, сечение ${fraction}: ширина ${(ratio * 100).toFixed(1)}% ближней`,
        );
      }
    }
  });
}

for (const leg of config.legs) {
  test(`Реальная подошва ${leg.name} достигает общего пола на всей опорной фазе`, () => {
    for (let index = 0; index <= 40; index += 1) {
      const local = EPSILON + ((config.stance - 2 * EPSILON) * index) / 40;
      const phase = globalPhase(local, leg);
      const actual = soleY(phase, leg);

      assert.equal(footPose(phase, leg, config).grounded, true);
      close(
        actual,
        config.shadow.y,
        POSITION_TOLERANCE,
        `${leg.name}, фаза ${wrapped(phase).toFixed(4)}: подошва должна касаться линии тени`,
      );
    }
  });
}

test('Деформация цельных контуров сохраняет непрерывность координат и скорости на стыках', () => {
  for (const leg of config.legs) {
    const boundaries = new Set([
      globalPhase(0, leg),
      globalPhase(config.stance, leg),
      ...config.legShapes[leg.shape].articulation.keys.map(([local]) => globalPhase(local, leg)),
      ...config.leg.toeRoll.keys.map(([local]) => globalPhase(local, leg)),
      0,
      1,
    ]);

    for (const part of ['silhouette', 'pawPath']) {
      const topology = contourCommands(config.legShapes[leg.shape][part]).flatMap(
        ({ name, points }) =>
          name === 'C'
            ? Array.from({ length: config.leg.contourSubdivisions }, () => [name, points.length])
            : [[name, points.length]],
      );
      const sample = (phase) => {
        const commands = renderedCommands(phase, leg, part);
        assert.deepEqual(
          commands.map(({ name, points }) => [name, points.length]),
          topology,
          `${leg.name}, ${part}: топология контура изменилась`,
        );

        return commands.flatMap(({ points }) => points.flat());
      };

      for (const boundary of boundaries) {
        continuousAt(sample, boundary, `${leg.name}, ${part}, фаза ${boundary}`);
      }
      sample(0).forEach((value, index) => close(value, sample(1)[index]));
    }
  }
});

for (const leg of config.legs) {
  test(`${leg.name} сгибает середину контура в переносе и распрямляет её к следующей опоре`, () => {
    const foldedKey = config.legShapes[leg.shape].articulation.keys.find(
      ([, shape]) => shape === 'folded',
    );
    assert.ok(foldedKey, `${leg.name}: отсутствует поза сгиба`);
    assert.ok(foldedKey[0] > config.stance && foldedKey[0] < 1);
    const contour = (local) =>
      sampledContour(contourCommands(legContour(globalPhase(local, leg), leg, config)));
    const standing = contour(config.stance / 2);
    const folded = contour(foldedKey[0]);
    const returned = contour(1);
    const root = standing[0];
    const ankleY = footPose(0, leg, config).y - config.legShapes[leg.shape].pawHeight;
    const middle = standing
      .map((point, index) => ({ point, index }))
      .filter(
        ({ point }) => point[1] > config.legShapes[leg.shape].deformStartY && point[1] < ankleY,
      );

    assert.equal(folded.length, standing.length);
    assert.ok(middle.length > 0, `${leg.name}: не найдена средняя часть лапы`);
    root.forEach((value, axis) => close(folded[0][axis], value));
    const deformation = middle.map(({ point, index }) => ({
      distance: Math.hypot(point[0] - folded[index][0], point[1] - folded[index][1]),
      radialChange: Math.abs(
        Math.hypot(point[0] - root[0], point[1] - root[1]) -
          Math.hypot(folded[index][0] - root[0], folded[index][1] - root[1]),
      ),
    }));

    assert.ok(
      Math.max(...deformation.map(({ distance }) => distance)) > MINIMUM_BEND_DISPLACEMENT,
      `${leg.name}: середина лапы не сгибается`,
    );
    // Поворот жёсткой вырезки вокруг корня не меняет расстояний до него.
    assert.ok(
      Math.max(...deformation.map(({ radialChange }) => radialChange)) > MINIMUM_BEND_DISPLACEMENT,
      `${leg.name}: сгиб заменён жёстким поворотом или смещением`,
    );
    standing.forEach((point, index) =>
      point.forEach((value, axis) =>
        close(returned[index][axis], value, POSITION_TOLERANCE, `${leg.name}: не распрямилась`),
      ),
    );
  });
}

test('В начале ближние и дальняя передняя опираются, дальняя задняя уже переносится', () => {
  for (const leg of config.legs) {
    const foot = footPose(0, leg, config);
    const lifted = leg.far && leg.shape === 'hind';
    assert.equal(foot.grounded, !lifted, `${leg.name}: неверная начальная опора`);
    if (lifted) assert.ok(foot.lift > 0, `${leg.name}: стопа должна быть поднята`);
    else close(foot.lift, 0);
  }
});

test('Корпус и голова замыкаются без скачка координат и скорости', () => {
  const sample = (phase) => Object.values(bodyPose(phase, config));

  sample(0).forEach((value, index) => close(value, sample(1)[index]));
  continuousAt(sample, 0, 'Корпус и голова');
  const beginningVelocity = velocityAt(sample, 0, 1);
  const endingVelocity = velocityAt(sample, 1, -1);
  beginningVelocity.forEach((value, index) => close(value, endingVelocity[index]));
});

for (const smileIntensity of new Set([config.mouth.smileIntensity, 0, 1])) {
  const expressionConfig = { ...config, mouth: { ...config.mouth, smileIntensity } };
  test(`Голова поворачивается в профиль; интенсивность улыбки ${smileIntensity}`, () => {
    const beginning = headPose(0, expressionConfig);
    const middle = headPose(config.blink.center, expressionConfig);

    close(beginning.turn, 0);
    close(beginning.smile, expressionConfig.mouth.smileIntensity);
    close(middle.turn, 1);
    close(middle.smile, 0);

    for (let index = 0; index <= SAMPLES; index += 1) {
      const pose = headPose(index / SAMPLES, expressionConfig);

      assert.ok(pose.turn >= 0 && pose.turn <= 1);
      assert.ok(pose.smile >= 0 && pose.smile <= expressionConfig.mouth.smileIntensity);
      if (pose.turn >= config.headTurn.smileEnd) close(pose.smile, 0);
      if (pose.turn <= config.headTurn.smileStart) close(pose.smile, beginning.smile);
    }
  });

  test(`Голова и улыбка ${smileIntensity} непрерывны на ключах и стыке цикла`, () => {
    const sample = (phase) => {
      const { turn, smile } = headPose(phase, expressionConfig);

      return [turn, smile];
    };

    for (const [phase] of config.headTurn.keys) {
      continuousAt(sample, phase, `Поворот головы, фаза ${phase}`);
    }
    sample(0).forEach((value, index) => close(value, sample(1)[index]));
    const start = velocityAt(sample, 0, 1);
    const end = velocityAt(sample, 1, -1);
    start.forEach((value, index) => close(value, end[index]));
  });

  test(`Одинаковый поворот даёт одинаковую улыбку при интенсивности ${smileIntensity}`, () => {
    const segments = config.headTurn.keys.slice(1).map((to, index) => ({
      from: config.headTurn.keys[index],
      to,
    }));
    const outward = segments.find(({ from, to }) => from[1] === 0 && to[1] === 1);
    const returning = segments.find(({ from, to }) => from[1] === 1 && to[1] === 0);

    assert.ok(outward && returning, 'Нужны оба направления поворота');
    for (let index = 0; index <= 100; index += 1) {
      const progress = index / 100;
      const outwardPhase = outward.from[0] + (outward.to[0] - outward.from[0]) * progress;
      const returnPhase =
        returning.from[0] + (returning.to[0] - returning.from[0]) * (1 - progress);
      const first = headPose(outwardPhase, expressionConfig);
      const second = headPose(returnPhase, expressionConfig);

      close(first.turn, second.turn);
      close(first.smile, second.smile, POSITION_TOLERANCE, `Рот при повороте ${first.turn}`);
    }
  });
}

test('За цикл происходит ровно одно моргание с максимумом на половине цикла', () => {
  close(config.blink.center, 0.5);
  close(blinkAmount(config.blink.center, config), 1);
  let intervals = 0;
  let wasClosed = false;
  let previous = 0;

  for (let index = 0; index <= SAMPLES; index += 1) {
    const phase = index / SAMPLES;
    const value = blinkAmount(phase, config);
    const closed = value > 0;

    assert.ok(value >= 0 && value <= 1);
    if (closed && !wasClosed) intervals += 1;
    if (phase <= config.blink.center) assert.ok(value >= previous);
    else assert.ok(value <= previous);
    previous = value;
    wasClosed = closed;
  }
  assert.equal(intervals, 1);
  for (const phase of [
    0,
    1,
    config.blink.center - config.blink.halfWidth,
    config.blink.center + config.blink.halfWidth,
  ]) {
    close(blinkAmount(phase, config), 0);
    continuousAt((time) => [blinkAmount(time, config)], phase, 'Моргание');
  }
  continuousAt((phase) => [blinkAmount(phase, config)], config.blink.center, 'Максимум моргания');
});

test('Корень хвоста закреплён на корпусе, а кончик движется относительно корня', () => {
  const tipXs = [];
  const tipYs = [];

  for (let index = 0; index <= SAMPLES; index += 1) {
    const phase = index / SAMPLES;
    const body = bodyPose(phase, config);
    const root = tailPoint(0, phase, config);
    const tip = tailPoint(1, phase, config);

    close(root[0] - body.x, config.tail.points[0][0]);
    close(root[1] - body.y, config.tail.points[0][1]);
    tipXs.push(tip[0] - root[0]);
    tipYs.push(tip[1] - root[1]);
  }
  assert.ok(Math.max(...tipXs) - Math.min(...tipXs) > config.tail.sway);
  assert.ok(Math.max(...tipYs) - Math.min(...tipYs) > config.tail.lift);

  for (const position of [0, 0.25, 0.5, 0.75, 1]) {
    const sample = (phase) => tailPoint(position, phase, config);
    sample(0).forEach((value, index) => close(value, sample(1)[index]));
    continuousAt(sample, 0, `Хвост, длина ${position}`);
    const start = velocityAt(sample, 0, 1);
    const end = velocityAt(sample, 1, -1);
    start.forEach((value, index) => close(value, end[index]));
  }
});

test('Единственный хвост проходит перед дальней задней и за ближней без передней накладки', () => {
  const face = JSON.parse(
    readFileSync(new URL(`../${config.paths.face}`, import.meta.url), 'utf8'),
  );
  const near = config.legs.find((leg) => !leg.far && leg.shape === 'hind');
  const far = config.legs.find((leg) => leg.far && leg.shape === 'hind');
  assert.ok(near && far);

  for (const phase of [0, 0.25, 0.5, 0.75]) {
    const svg = lemurFrameSvg(phase, config, face);
    const tails = [...svg.matchAll(/<g data-layer="tail">([\s\S]*?)<\/g>/g)];
    assert.equal(tails.length, 1, 'Хвост должен рисоваться один раз');
    assert.ok(tails[0][1].includes('<path'), 'Слой хвоста не должен быть пустым');
    const position = svg.indexOf('data-layer="tail"');
    assert.ok(position > svg.indexOf(`data-layer="${far.name}"`));
    assert.ok(position < svg.indexOf(`data-layer="${near.name}"`));
    assert.ok(!svg.includes('tail-root'), 'Поверх ближнего бедра не должно быть корневой накладки');
  }
});

test('Ближнее ухо рисуется перед макушкой, сохраняет крепление под щекой и не обрезается', () => {
  const face = JSON.parse(
    readFileSync(new URL(`../${config.paths.face}`, import.meta.url), 'utf8'),
  );
  const order = face.renderOrder.map((entry) => entry.name);
  assert.ok(order.indexOf('ear-near') > order.indexOf('crown'));
  assert.ok(order.indexOf('ear-near') < order.indexOf('face'));
  assert.ok(!face.profileClipNames.includes('ear-near'));

  // Различимые заливки проверяют порядок фактического SVG без привязки к округлению координат.
  const markers = { crown: '#010101', 'ear-near': '#020202', face: '#030303' };
  const markedFace = {
    ...face,
    layers: face.layers.map((layer) => ({ ...layer, fill: markers[layer.name] ?? layer.fill })),
  };
  for (const [phase] of config.headTurn.keys) {
    const svg = lemurFrameSvg(phase, config, markedFace);
    const positions = Object.fromEntries(
      Object.entries(markers).map(([name, fill]) => [name, svg.indexOf(`fill="${fill}"`)]),
    );
    assert.ok(positions.crown >= 0);
    assert.ok(positions['ear-near'] > positions.crown);
    assert.ok(positions.face > positions['ear-near']);
  }
});
