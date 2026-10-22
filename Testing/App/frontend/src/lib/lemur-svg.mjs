export const number = (value) => Number(value.toFixed(3));
export const pair = (point) => point.map(number).join(' ');
export const path = (data, fill, extra = '') => `<path d="${data}" fill="${fill}" ${extra}/>`;
export const group = (transform, content) => `<g transform="${transform}">${content}</g>`;
export function morphPath(source, target, amount) {
  const values = target.match(/-?\d+(?:\.\d+)?/g).map(Number);
  let index = 0;

  return source.replace(/-?\d+(?:\.\d+)?/g, (value) =>
    String(number(Number(value) + (values[index++] - Number(value)) * amount)),
  );
}
export const ellipse = (center, radii, fill, extra = '') =>
  `<ellipse cx="${number(center[0])}" cy="${number(center[1])}" rx="${number(radii[0])}" ry="${number(radii[1])}" fill="${fill}" ${extra}/>`;

export function lemurEyeAperture({ x, y, width, height }, lid, blink, margin, region) {
  const top = y - margin + (lid.closedY - y + margin) * blink;
  const bottom = y + height + margin + (lid.closedY - y - height - margin) * blink;
  const bend = lid.curveLift * blink;

  if (region !== undefined) {
    if (blink === 1) return 'M 0 0 Z';

    let coordinate = 0;
    let horizontal = 0;

    return region.replace(/-?\d+(?:\.\d+)?/g, (value) => {
      coordinate++;
      if (coordinate % 2) {
        horizontal = (Number(value) - x - width / 2) / (width / 2);
        return value;
      }

      return String(
        lid.closedY +
          (Number(value) - lid.closedY) * (1 - blink) -
          bend * (1 - horizontal * horizontal),
      );
    });
  }

  return `M ${x - margin} ${top} Q ${x + width / 2} ${top - bend * 2} ${x + width + margin} ${top} L ${x + width + margin} ${bottom} Q ${x + width / 2} ${bottom - bend * 2} ${x - margin} ${bottom} Z`;
}

export function lemurHeadLayers(head, colors) {
  return head.layers
    .map((layer) => path(layer.path, layer.fill === 'cream' ? 'url(#cream)' : colors[layer.fill]))
    .join('');
}

export function lemurGradients(color) {
  return `<linearGradient id="cream" x2="0.6" y2="1"><stop stop-color="${color.creamLight}"/><stop offset="1" stop-color="${color.cream}"/></linearGradient><linearGradient id="iris" x2="0.4" y2="1"><stop stop-color="${color.irisLight}"/><stop offset="1" stop-color="${color.iris}"/></linearGradient>`;
}
