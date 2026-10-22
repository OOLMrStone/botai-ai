export function animationChannel(time, keys) {
  const index = keys.findIndex(([at]) => at > time);
  if (index < 0) return keys.at(-1)[1];
  if (index === 0) return keys[0][1];

  const [start, from] = keys[index - 1];
  const [end, to] = keys[index];
  const t = (time - start) / (end - start);
  const eased = t * t * t * (10 + t * (-15 + 6 * t));

  return from + (to - from) * eased;
}
