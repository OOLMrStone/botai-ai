// Чистая математика арт-сферы из точек: раскладка по поверхности, вращение с
// прецессией и физика волны от касания. Ни React, ни DOM, ни canvas - только
// формулы, поэтому модуль переносится на любую платформу (напр. Swift/Metal)
// один-в-один. Обвязка (canvas, портал, жесты, RAF) живёт в ParticleSphere.tsx.

// Параметры вращения сферы (рад/с). Число точек - забота вызывающей стороны
// (перф зависит от платформы), передаётся в distributeSphere.
export const SPIN_SPEED = 0.12;
export const TILT_BASE = 0.5;
export const TILT_SWAY = 0.15;
export const TILT_SPEED = 0.25;

// Волна от касания: разовый импульс на тап (px/с), непрерывная сила пока палец
// зажат (px/с²), гауссово затухание по расстоянию и недодемпфированная пружина
// возврата.
export const WAVE_IMPULSE = 380;
export const HOLD_FORCE = 2800;
export const WAVE_RADIUS_FACTOR = 0.4;
export const WAVE_SPRING = 42;
export const WAVE_DAMPING = 9;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

// Тригонометрия одного кадра: спин вокруг вертикали и наклон оси (прецессия).
// Считается один раз на кадр и передаётся в projectPoint для всех точек.
export interface Frame {
  cosS: number;
  sinS: number;
  cosT: number;
  sinT: number;
}

export interface Projected {
  x: number;
  y: number;
  edge: number;
}

// Fibonacci-распределение - равномерная сетка точек по поверхности сферы.
export function distributeSphere(count: number): Point3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
  });
}

// Спин и наклон текущего момента в тригонометрию кадра.
export function frameAt(t: number): Frame {
  const spin = t * SPIN_SPEED;
  const tilt = TILT_BASE + Math.sin(t * TILT_SPEED) * TILT_SWAY;
  return { cosS: Math.cos(spin), sinS: Math.sin(spin), cosT: Math.cos(tilt), sinT: Math.sin(tilt) };
}

// Вращение вокруг вертикали, затем наклон оси. edge (1 - |z|) - близость к
// силуэту: у края точки ярче и крупнее, объём читается без 3D.
export function projectPoint(p: Point3, f: Frame): Projected {
  const x1 = p.x * f.cosS + p.z * f.sinS;
  const z1 = -p.x * f.sinS + p.z * f.cosS;
  const y1 = p.y * f.cosT - z1 * f.sinT;
  const z2 = p.y * f.sinT + z1 * f.cosT;

  return { x: x1, y: y1, edge: 1 - Math.abs(z2) };
}

// Гауссово затухание силы по расстоянию от эпицентра касания.
export function gaussianFalloff(dist: number, sigma: number): number {
  return Math.exp(-(dist * dist) / (2 * sigma * sigma));
}

// Шаг недодемпфированной пружины возврата (полу-неявный Эйлер): точку тянет к
// нулевому смещению, скорость гасится демпфированием. Возвращает новые [offset, velocity].
export function stepSpring(
  offset: number,
  velocity: number,
  dt: number,
): [offset: number, velocity: number] {
  const v = velocity + (-WAVE_SPRING * offset - WAVE_DAMPING * velocity) * dt;
  return [offset + v * dt, v];
}
