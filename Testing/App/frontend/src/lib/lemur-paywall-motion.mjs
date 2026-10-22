import { animationChannel } from './animation-channel.mjs';

export function paywallGesture(time, config) {
  return animationChannel(time % config.gestureDuration, config.keys);
}

export function paywallFace(time, config) {
  return {
    gaze: animationChannel(time, config.face.gazeKeys),
    blink: animationChannel(time, config.face.blinkKeys),
  };
}

export function bendPaywallPaw(x, y, angle, config) {
  const [start, end] = config.flexRange;
  const phase = Math.max(0, Math.min(1, (y - start) / (end - start)));
  const bend = angle * phase * phase * (3 - 2 * phase);
  const [rootX, rootY] = config.pivot;
  const dx = x - rootX;
  const dy = y - rootY;

  return [
    rootX + dx * Math.cos(bend) - dy * Math.sin(bend),
    rootY + dx * Math.sin(bend) + dy * Math.cos(bend) + bend * config.travelPerRadian,
  ];
}
