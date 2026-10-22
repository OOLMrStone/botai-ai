import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { waveTailPoint } from '../src/lib/lemur-wave-tail.mjs';
import { waveArm, wavePose } from '../src/lib/lemur-wave-motion.mjs';
import { lemurWaveSvg } from '../src/lib/lemur-wave-svg.mjs';

const motion = JSON.parse(
  readFileSync(new URL('../src/config/lemur-wave-motion.json', import.meta.url), 'utf8'),
);
const art = JSON.parse(readFileSync(new URL(`../${motion.paths.art}`, import.meta.url), 'utf8'));
const rightArm = art.arms.find((arm) => arm.name === 'screen-left');
const leftArm = art.arms.find((arm) => arm.name === 'screen-right');
const waveTurns = motion.channels.wave.slice(1, -1).map(([time]) => time);

test('Машет только анатомически правая лапа Бо, экранно слева', () => {
  const raised = wavePose(0.88, motion);
  const wavingArm = waveArm(rightArm, raised, motion);
  const restingArm = waveArm(leftArm, raised, motion);

  assert.deepEqual(
    wavingArm.root,
    waveArm(rightArm, wavePose(0, motion), motion).root,
    'Корень машущей лапы оторвался от плеча',
  );
  assert.deepEqual(
    wavingArm.radii,
    motion.raisedArm.radii,
    'Машущая лапа использует другую толщину вместо постоянного профиля',
  );
  assert.notDeepEqual(wavingArm.end, rightArm.end, 'Правая лапа не поднялась');
  assert.deepEqual(restingArm.end, leftArm.end, 'Вторая лапа начала повторять жест');
});

test('Ладонь машущей лапы остаётся снаружи силуэта головы', () => {
  for (const time of motion.qaTimes) {
    const pose = wavePose(time, motion);
    const arm = waveArm(rightArm, pose, motion);
    const svg = lemurWaveSvg(time, art, motion);

    assert.ok(svg.includes('data-part="waving-arm"'), `Лапа потеряна при t=${time}`);
    if (pose.arm > 0.8) {
      assert.ok(arm.end[0] + rightArm.paw[0] < 181, `Ладонь зашла в щёку при t=${time}`);
    }
  }
});

test('Кремовые мосты соединяют уши со щеками только в wave-ригe', () => {
  const svg = lemurWaveSvg(0, art, motion);

  for (const bridge of motion.head.earBridges) {
    assert.ok(svg.includes(bridge), 'Потерян локальный кремовый мост уха');
  }
  assert.equal(art.head.layers.length, 6, 'Общий одобренный фронтальный риг был изменён');
});

test('Хвост полностью переносится вправо за корпус при закреплённом корне', () => {
  const rootAtRest = waveTailPoint(0, 0, art, motion);
  const rootRaised = waveTailPoint(0, 1.22, art, motion);
  const tipAtRest = waveTailPoint(1, 0, art, motion);
  const tipRaised = waveTailPoint(1, 1.22, art, motion);

  const lean = wavePose(1.22, motion).lean;
  assert.deepEqual(
    rootRaised,
    [rootAtRest[0] + lean * (rootAtRest[1] - art.floor), rootAtRest[1]],
    'Корень хвоста не следует за тазом',
  );
  assert.ok(tipAtRest[0] < 150, 'Исходный хвост должен быть слева');
  assert.ok(tipRaised[0] > 480, 'Кончик хвоста не вышел справа от корпуса');
});

test('Два взмаха идут горизонтально высоко сбоку, а не вверх-вниз у тела', () => {
  const tips = waveTurns.map((time) => waveArm(rightArm, wavePose(time, motion), motion).end);
  for (let index = 1; index < tips.length; index++) {
    const delta = tips[index][0] - tips[index - 1][0];
    assert.ok(Math.abs(delta) > 55, 'Горизонтальный размах не читается');
    assert.ok(index % 2 ? delta < 0 : delta > 0, 'Лапа не чередует боковые взмахи');
  }

  const points = [];
  for (let time = waveTurns[0]; time <= waveTurns.at(-1); time += 1 / motion.fps) {
    points.push(waveArm(rightArm, wavePose(time, motion), motion).end);
  }
  const range = (axis) =>
    Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]));
  assert.ok(range(0) > 2 * range(1), 'Жест снова стал преимущественно вертикальным');
  assert.ok(
    points.every((p) => p[1] < 180 && p[0] + rightArm.paw[0] < 181),
    'Кисть опустилась к телу или зашла в лицо',
  );
});

test('Дуга заметно выгнута, а касательная в середине близка к горизонтали', () => {
  const tip = (wave) => waveArm(rightArm, { arm: 1, wave }, motion).end;
  const start = tip(-1);
  const end = tip(1);
  const middle = tip(0);
  const chord = end.map((value, axis) => value - start[axis]);
  const offset = middle.map((value, axis) => value - start[axis]);
  const sagitta = Math.abs(chord[0] * offset[1] - chord[1] * offset[0]) / Math.hypot(...chord);
  const before = tip(-0.001);
  const after = tip(0.001);
  const slope = Math.abs((after[1] - before[1]) / (after[0] - before[0]));

  assert.ok(sagitta > 12 && sagitta < 18, `Дуга слишком плоская или крутая: ${sagitta}`);
  assert.ok(slope < Math.tan(Math.PI / 18), 'Касательная в середине стала слишком вертикальной');
});

test('Восстановленная кисть не содержит розовой подушечки', () => {
  for (const time of motion.qaTimes) {
    assert.ok(!lemurWaveSvg(time, art, motion).includes('data-part="palm-pad"'));
  }
});

test('Удалены все внутренние обводки лап', () => {
  for (const time of motion.qaTimes) {
    assert.ok(
      !lemurWaveSvg(time, art, motion).includes('fill="none"'),
      'В кадре остались внутренние линии',
    );
  }
});

test('Нарисованная ось лапы сохраняет длину и толщину при боковом сгибании', () => {
  const reference = waveArm(rightArm, wavePose(waveTurns[0], motion), motion);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  for (let time = waveTurns[0]; time <= waveTurns.at(-1); time += 1 / motion.fps) {
    const arm = waveArm(rightArm, wavePose(time, motion), motion);
    let length = 0;
    let previous = arm.pointAt(0);
    for (let index = 1; index <= 400; index++) {
      const point = arm.pointAt(index / 400);
      length += distance(previous, point);
      previous = point;
    }
    assert.ok(
      Math.abs(length - motion.raisedArm.axisLength) < 0.01,
      `Изменена длина нарисованной лапы при t=${time}: ${length}`,
    );
    assert.ok(distance(arm.pointAt(0), arm.root) < 1e-7);
    assert.ok(distance(arm.pointAt(1), arm.end) < 1e-7);
    assert.deepEqual(arm.radii, reference.radii);
    const svg = lemurWaveSvg(time, art, motion);
    assert.match(
      svg,
      /<g transform="translate\([^\"]+\)"><g data-part="waving-arm">/,
      'Наклон корпуса снова растягивает вращающуюся лапу',
    );
  }
});

test('При подъёме ладонь обходит плечо по дуге, не проваливаясь к его центру', () => {
  const root = motion.armRest[rightArm.name].root;
  const restRadius = Math.hypot(rightArm.end[0] - root[0], rightArm.end[1] - root[1]);

  for (let time = 0.3; time <= 0.66; time += 1 / motion.fps) {
    const pose = wavePose(time, motion);
    if (pose.arm < 0) continue;
    const arm = waveArm(rightArm, pose, motion);
    assert.ok(
      Math.hypot(arm.end[0] - root[0], arm.end[1] - root[1]) >= restRadius,
      `Лапа схлопнулась во время подъёма при t=${time}`,
    );
  }
});

test('Финальное удержание совпадает с исходной стойкой и замыкается', () => {
  const start = lemurWaveSvg(0, art, motion);

  assert.equal(lemurWaveSvg(motion.restLoopStart, art, motion), start);
  assert.equal(lemurWaveSvg(motion.duration, art, motion), start);
});

test('Вход, развороты и выход взмаха не переключают ускорение скачком', () => {
  const value = (time) => wavePose(time, motion).wave;

  for (const step of [1e-4, 5e-5]) {
    for (const time of waveTurns) {
      const center = value(time);
      const before = (value(time - 2 * step) - 2 * value(time - step) + center) / step ** 2;
      const after = (value(time + 2 * step) - 2 * value(time + step) + center) / step ** 2;

      assert.ok(
        Math.abs(after - before) < 0.5,
        `Скачок ускорения при t=${time}: ${after - before}`,
      );
    }
  }
});

test('В каждом полувзмахе замедление есть у обоих концов, без вставленной паузы', () => {
  const value = (time) => wavePose(time, motion).wave;

  for (let index = 1; index < waveTurns.length; index++) {
    const start = waveTurns[index - 1];
    const duration = waveTurns[index] - start;
    const interval = duration / 10;
    const first = Math.abs(value(start + interval) - value(start));
    const middle = Math.abs(value(start + duration * 0.55) - value(start + duration * 0.45));
    const last = Math.abs(value(start + duration) - value(start + duration - interval));

    assert.ok(first > 0 && last > 0, 'Добавлено неподвижное удержание внутри взмаха');
    assert.ok(first < middle / 3 && last < middle / 3, 'Край движется так же резко, как середина');
  }
});

test('Рот закрыт в стойке и открыт во время всех взмахов', () => {
  for (const time of [0, motion.restLoopStart, motion.duration]) {
    assert.equal(wavePose(time, motion).mouthOpen, 0);
    assert.ok(lemurWaveSvg(time, art, motion).includes(`d="${art.head.closedMouth}"`));
  }
  for (const time of waveTurns) {
    assert.equal(wavePose(time, motion).mouthOpen, 1);
    assert.ok(lemurWaveSvg(time, art, motion).includes(`d="${art.head.mouth}"`));
  }
});

test('Одно моргание на возврате не перекрывает основную серию махов', () => {
  const peaks = motion.channels.blink.filter(([, amount]) => amount > 0);
  assert.equal(peaks.length, 1);
  for (const [time, amount] of peaks) {
    assert.ok(amount > 0.9);
    assert.equal(wavePose(time, motion).blink, amount);
  }
  for (const time of waveTurns) assert.equal(wavePose(time, motion).blink, 0);
});

test('Тень остаётся одной неподвижной горизонтальной полоской', () => {
  for (const time of motion.qaTimes) {
    const svg = lemurWaveSvg(time, art, motion);
    const shadow = `cx="${art.shadow.cx}" cy="${art.shadow.cy}" rx="${art.shadow.rx}" ry="${art.shadow.ry}"`;

    assert.equal(svg.split(shadow).length - 1, 1, `Тень изменилась при t=${time}`);
  }
});
