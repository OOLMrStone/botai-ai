export const STUDY_TIMER = {
  heartbeatMs: 15_000,
  displayMs: 1_000,
  millisecondsPerSecond: 1_000,
  secondsPerMinute: 60,
  defaultMaxGapSeconds: 45,
  digits: 2,
  endpoints: {
    start: '/api/activity-timer/start',
    heartbeat: '/api/activity-timer/heartbeat',
    pause: '/api/activity-timer/pause',
  },
} as const;

export const STUDY_TIMER_COPY = {
  active: 'Время занятия',
  connecting: 'Подключаем таймер',
  paused: 'Таймер на паузе',
  offline: 'Нет связи - таймер на паузе',
  elsewhere: 'Таймер работает в другой вкладке',
} as const;
