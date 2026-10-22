import { LEMUR_COPY } from '@/config/lemur-copy';
import joyMotion from '@/config/lemur-joy-motion.json';
import hangMotion from '@/config/lemur-hang-motion.json';

export interface LemurAnimation {
  title: string;
  subtitle: string;
  label: string;
  video: string;
  poster: string;
  loop: boolean;
  loopFrom?: number;
  seamlessLoop?: { duration: number; fps: number; overlap: number };
  reaction?: {
    video: string;
    label: string;
    pendingLabel?: string;
    syncPeriod?: number;
    syncTolerance?: number;
    cycleDuration?: number;
    duration?: number;
    phases?: readonly { offset: number; video: string }[];
  };
  square?: boolean;
  rendering?: 'packed-alpha';
  frameSize?: { width: number; height: number };
}

const hangMediaPath = `/${hangMotion.paths.output.replace(/^public\//, '')}`;
const hangMediaVersion = '?v=9';
const hangReactionPhases = Array.from(
  { length: Math.round(hangMotion.duration / hangMotion.reactionPhaseStep) },
  (_, index) => ({
    offset: index * hangMotion.reactionPhaseStep,
    video: `${hangMediaPath}/${hangMotion.reactionPhaseVideo
      .replace('{index}', String(index).padStart(hangMotion.reactionPhaseDigits, '0'))
      .replace('.mp4', '-alpha.mp4')}${hangMediaVersion}`,
  }),
);

export const LEMUR_ANIMATIONS = {
  paywall: {
    ...LEMUR_COPY.paywall,
    video: '/paywall-preview/lemur-alpha.mp4?v=alpha-v1',
    poster: '/paywall-preview/lemur-alpha-poster.png?v=alpha-v1',
    rendering: 'packed-alpha',
    frameSize: { width: 1536, height: 1024 },
    loop: true,
  },
  cool: {
    ...LEMUR_COPY.cool,
    video: '/lemur-cool/cool.mp4?v=2',
    poster: '/lemur-cool/poster.png?v=2',
    loop: true,
    square: true,
  },
  hang: {
    ...LEMUR_COPY.hang,
    video: `${hangMediaPath}/idle-alpha.mp4${hangMediaVersion}`,
    poster: `${hangMediaPath}/poster-alpha.png${hangMediaVersion}`,
    rendering: 'packed-alpha',
    loop: true,
    seamlessLoop: {
      duration: hangMotion.duration,
      fps: hangMotion.fps,
      overlap: hangMotion.loopOverlap,
    },
    reaction: {
      video: hangReactionPhases[0].video,
      label: LEMUR_COPY.hang.reactionLabel,
      pendingLabel: LEMUR_COPY.hang.pendingLabel,
      syncPeriod: hangMotion.reactionPhaseStep,
      cycleDuration: hangMotion.duration,
      duration: hangMotion.reactionEnd,
      phases: hangReactionPhases,
      syncTolerance: 1 / hangMotion.fps,
    },
    square: true,
  },
  walk: {
    ...LEMUR_COPY.walk,
    label: 'Покадровая походка лемура с одним морганием и движением хвоста',
    video: '/lemur-walk/walk.mp4?v=12',
    poster: '/lemur-walk/poster.png?v=12',
    loop: true,
  },
  joy: {
    ...LEMUR_COPY.joy,
    label:
      'Радостный лемур подпрыгивает со сверкающими глазами и остаётся радостно стоять на лапках',
    video: '/lemur-joy/joy-alpha.mp4?v=alpha-v1',
    poster: '/lemur-joy/poster-alpha.png?v=alpha-v1',
    rendering: 'packed-alpha',
    loop: false,
    loopFrom: joyMotion.restLoopStart,
  },
  wave: {
    ...LEMUR_COPY.wave,
    video: '/lemur-wave/wave-alpha.mp4?v=alpha-v1',
    poster: '/lemur-wave/poster-alpha.png?v=alpha-v1',
    rendering: 'packed-alpha',
    loop: true,
  },
  cry: {
    ...LEMUR_COPY.cry,
    video: '/lemur-cry/cry.mp4?v=6-restored',
    poster: '/lemur-cry/poster.png?v=6-restored',
    loop: true,
  },
  sit: {
    ...LEMUR_COPY.sit,
    video: '/lemur-sit/sit-alpha.mp4?v=alpha-v1',
    poster: '/lemur-sit/poster-alpha.png?v=alpha-v1',
    rendering: 'packed-alpha',
    loop: true,
  },
  sitLeft: {
    ...LEMUR_COPY.sitLeft,
    video: '/lemur-sit-left/sit-left.mp4?v=3',
    poster: '/lemur-sit-left/poster.png?v=3',
    loop: true,
  },
} as const satisfies Record<string, LemurAnimation>;
