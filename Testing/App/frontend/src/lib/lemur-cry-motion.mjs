import { animationChannel } from './animation-channel.mjs';

export function cryPose(time, motion) {
  const t = ((time % motion.duration) + motion.duration) % motion.duration;
  const channels = Object.fromEntries(
    Object.entries(motion.channels).map(([name, keys]) => [name, animationChannel(t, keys)]),
  );
  const breath = (1 - Math.cos((t / motion.duration) * Math.PI * 2)) / 2;
  const tremble = Math.sin((t / motion.duration) * Math.PI * 2 * motion.face.trembleCycles);

  return {
    ...channels,
    headY: channels.head * motion.sob.headY + breath * motion.breath.headY,
    headTilt: channels.head * motion.sob.headTilt + breath * motion.breath.headTilt,
    hugTilt: channels.squeeze * motion.sob.hugTilt + breath * motion.breath.hugTilt,
    water: channels.sob * motion.sob.eyeWater,
    eyeOpen: (1 - channels.blink) * (1 + channels.appeal * motion.face.eyeStretch),
    mouthX: tremble * channels.sob * motion.face.mouthX,
    mouthY: tremble * channels.sob * motion.face.mouthY,
    muzzleY: channels.mouthOpen * motion.face.muzzleY,
  };
}

export function cryWater(time, index, motion) {
  const settings = motion.water;
  const phase =
    (time / motion.duration) * Math.PI * 2 * settings.cycles - index * settings.phaseOffset;

  return {
    surface:
      Math.sin(phase) * settings.surface +
      cryPose(time - settings.delay, motion).water * settings.sobInfluence,
    tilt: Math.sin(phase) * settings.tilt,
    reflectionX: Math.sin(phase) * settings.reflectionX,
    reflectionY: Math.cos(phase) * settings.reflectionY,
    shimmer: Math.cos(phase) * settings.shimmer,
  };
}

export function cryHighlight(time, eye, highlight, motion) {
  const settings = motion.face;
  const pose = cryPose(time, motion);
  const phase =
    (time / motion.duration) * Math.PI * 2 * settings.trembleCycles -
    eye * settings.highlightPhase -
    highlight * settings.highlightSecondaryPhase;

  return {
    x: Math.sin(phase) * pose.sob * settings.highlightX,
    y: Math.cos(phase) * pose.sob * settings.highlightY,
    scale: 1 + pose.appeal * settings.highlightScale,
  };
}
