import { animationChannel } from './animation-channel.mjs';

export function sitPose(time, motion) {
  const t = ((time % motion.duration) + motion.duration) % motion.duration;
  const breath = (1 - Math.cos((t / motion.duration) * motion.breath.cycles * Math.PI * 2)) / 2;

  return {
    blink: animationChannel(t, motion.blink),
    bodyScaleY: 1 + breath * motion.breath.bodyScaleY,
    headY: breath * motion.breath.headY,
  };
}
