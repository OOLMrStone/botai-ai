import { STOREFRONT_GRAPH as GRAPH } from '@/config/storefront-graph';

export function heartGraphPoints() {
  // После кубического корня уравнение квадратно по y; обе ветви дают точный контур.
  const discriminant = (x: number) => Math.abs(x) ** (4 / 3) - 4 * (x * x - 1);
  let [low, high]: number[] = [...GRAPH.rootBounds];
  for (let index = 0; index < GRAPH.rootIterations; index++) {
    const middle = (low + high) / 2;
    if (discriminant(middle) > 0) low = middle;
    else high = middle;
  }
  const edge = (low + high) / 2;
  const branch = (direction: number) =>
    Array.from({ length: GRAPH.samples + 1 }, (_, index) => {
      const x = -edge * Math.cos((Math.PI * index) / GRAPH.samples);
      const y = (Math.abs(x) ** (2 / 3) + direction * Math.sqrt(Math.max(0, discriminant(x)))) / 2;
      return { x, y };
    });

  return [...branch(1), ...branch(-1).reverse()];
}
