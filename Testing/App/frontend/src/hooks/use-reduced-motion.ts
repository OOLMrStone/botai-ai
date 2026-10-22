'use client';

import { useSyncExternalStore } from 'react';

import { QUIZ_MOTION } from '@/config/quiz-motion';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(QUIZ_MOTION.reducedMotionQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function snapshot() {
  return window.matchMedia(QUIZ_MOTION.reducedMotionQuery).matches;
}

function serverSnapshot() {
  return true;
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
