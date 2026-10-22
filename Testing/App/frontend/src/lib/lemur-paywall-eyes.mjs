import palette from '../config/lemur-paywall-palette.json' with { type: 'json' };

const colors = Object.fromEntries(palette.map(({ name, fill }) => [name, fill]));
const clamp = (value) => Math.max(0, Math.min(1, value));

function pixelOffset(x, y, info) {
  return (y * info.width + x) * info.channels;
}

function goldAt(clean, offset, matte) {
  return (
    clean[offset] > matte.goldMin &&
    clean[offset + 1] > matte.goldGreen &&
    clean[offset + 2] < matte.goldBlue &&
    clean[offset] - clean[offset + 1] > matte.goldContrast
  );
}

export function preparePaywallEyes(clean, info, config) {
  return config.face.eyes.map((eye) => {
    const [left, top, right, bottom] = eye.region;
    const pixels = [];
    const radius = config.face.eyeDilation;

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = pixelOffset(x, y, info);
        let interior = false;
        for (let dy = -radius; dy <= radius && !interior; dy++) {
          for (let dx = -radius; dx <= radius && !interior; dx++) {
            interior = goldAt(clean, pixelOffset(x + dx, y + dy, info), config.face.matte);
          }
        }
        if (interior) pixels.push({ x, y, offset, gold: goldAt(clean, offset, config.face.matte) });
      }
    }

    return { ...eye, pixels };
  });
}

function ellipseCoverage(x, y, cx, cy, rx, ry, softness) {
  const radius = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return clamp(((1 - radius) * Math.min(rx, ry)) / softness + 0.5);
}

export function renderPaywallEyes(buffer, original, clean, eyes, pose, config) {
  if (pose.gaze === 0 && pose.blink === 0) return;
  const face = config.face;
  const lid = face.lid;

  for (const eye of eyes) {
    const [cx, cy] = eye.center;
    const [low, high] = eye.lidRange;
    const upper = low + (eye.closureY - low) * pose.blink;
    const lower = high + (eye.closureY - high) * pose.blink;
    const [px, py, rx, ry] = eye.pupil;
    const pupilX = px + eye.gaze[0] * pose.gaze;
    const pupilY = py + eye.gaze[1] * pose.gaze;
    const [shineX, shineY, shineRadius] = eye.shine;

    for (const { x, y, offset, gold } of eye.pixels) {
      const pupil = gold ? ellipseCoverage(x, y, pupilX, pupilY, rx, ry, face.pupilSoftness) : 0;
      const shine =
        pupil *
        ellipseCoverage(
          x,
          y,
          pupilX + shineX,
          pupilY + shineY,
          shineRadius,
          shineRadius,
          face.pupilSoftness,
        );
      const localY = y - cy - (x - cx) * eye.lidSlope;
      const curve = (x - cx) ** 2 * lid.curve;
      const aperture = clamp(
        Math.min(localY - upper - curve, lower + curve - localY) / lid.softness,
      );
      const closed = pose.blink > 0 ? 1 - aperture : 0;
      const line =
        pose.blink *
        clamp((lid.lineWidth - Math.abs(localY - eye.closureY - curve)) / lid.softness);

      for (let channel = 0; channel < 3; channel++) {
        const looking = clean[offset + channel] * (1 - pupil) + colors.pupil[channel] * pupil;
        const lit = looking * (1 - shine) + colors.background[channel] * shine;
        const color = pose.gaze === 0 ? original[offset + channel] : lit;
        const eyelid = colors.dark[channel] * (1 - line) + colors.nose[channel] * line;
        buffer[offset + channel] = Math.round(color * (1 - closed) + eyelid * closed);
      }
    }
  }
}
