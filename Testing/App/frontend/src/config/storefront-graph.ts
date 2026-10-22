export const STOREFRONT_GRAPH = {
  viewBox: '-1.95 -1.7 3.75 3.55',
  extent: 1.5,
  ticks: [-1.5, -1, -0.5, 0, 0.5, 1, 1.5],
  samples: 480,
  rootIterations: 48,
  rootBounds: [1, 1.5],
  stroke: { grid: 0.007, axis: 0.014, heart: 0.018 },
  gridDash: '0.014 0.04',
  labels: { size: 0.13, gap: 0.09, baseline: 0.05, font: 'Arial, sans-serif' },
} as const;

export const STOREFRONT_GRAPH_VIDEO = {
  width: 1200,
  height: 1050,
  fps: 60,
  duration: 2.2,
  drawDuration: 1.8,
  markerRadius: 0.035,
  colors: { background: '#ffffff', grid: '#a3a8ad', axis: '#53585c', heart: '#e85064' },
  video: '/storefront/heart/draw-v2.mp4',
  poster: '/storefront/heart/grid-v2.png',
  complete: '/storefront/heart/heart-v2.png',
} as const;
