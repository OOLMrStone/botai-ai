import { STOREFRONT_COPY } from '@/config/storefront';

import type { LemurAnimation } from '@/config/lemur-media';

export const LANDING_BO = {
  camera: {
    title: STOREFRONT_COPY.workflow.steps[0].title,
    subtitle: '',
    label: 'Бо фотографирует решение на телефон',
    video: '/landing/bo-camera/camera-alpha.mp4?v=4',
    poster: '/landing/bo-camera/poster-alpha.png?v=4',
    frameSize: { width: 1080, height: 720 },
    rendering: 'packed-alpha',
    loop: true,
  },
  scan: {
    title: STOREFRONT_COPY.workflow.steps[1].title,
    subtitle: '',
    label: 'Бо наблюдает за проверкой решения',
    video: '/landing/bo-scan/scan-alpha.mp4?v=3',
    poster: '/landing/bo-scan/poster-alpha.png?v=3',
    frameSize: { width: 1200, height: 800 },
    rendering: 'packed-alpha',
    loop: true,
  },
  result: {
    title: STOREFRONT_COPY.workflow.steps[2].title,
    subtitle: '',
    label: 'Бо чешет макушку, глядя на результат по геометрии: один балл из трёх',
    video: '/landing/bo-result/result-alpha.mp4?v=5',
    poster: '/landing/bo-result/poster-alpha.png?v=5',
    frameSize: { width: 1200, height: 800 },
    rendering: 'packed-alpha',
    loop: true,
  },
  holder: {
    title: STOREFRONT_COPY.graph.title,
    subtitle: '',
    label: 'Бо держится широкими лапками за окно, смотрит на тебя и иногда вниз',
    video: '/landing/bo-holder/holder-alpha.mp4?v=4',
    poster: '/landing/bo-holder/poster-alpha.png?v=4',
    frameSize: { width: 1080, height: 1080 },
    rendering: 'packed-alpha',
    loop: true,
  },
} as const satisfies Record<string, LemurAnimation>;

export const LANDING_BO_HOLDER = {
  paws: { src: '/landing/bo-holder/paws-alpha.png?v=3', width: 1080, height: 1080 },
  contactLine: 0.5642857142857143,
} as const;
