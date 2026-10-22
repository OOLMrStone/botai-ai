// Технические константы приложения. Никаких магических чисел в коде - только отсюда.

// Тайминги (мс). courseBuildMs делят лоадер «строим курс» и мок buildCourse.
export const TIMINGS = {
  courseBuildMs: 3500,
  mockLatencyMs: 600,
  apiRequestTimeoutMs: 10000,
} as const;

export const COMMITMENT_SEAL = {
  holdDurationMs: 1400,
  moveTolerancePx: 18,
} as const;

// Арт-сфера. dprCap - потолок плотности рендера: ниже реального DPR экрана
// точки становятся мылом (буфер растягивается), выше 3 - лишний расход впустую.
export const SPHERE = {
  points: 1500,
  dprCap: 3,
} as const;

export const TASK_DRAWING = {
  lineWidth: 3,
  eraserRadius: 14,
  dprCap: 2,
  pointMinDistancePx: 2,
  workspaceBottomSpacePx: 176,
  workspaceGrowthThresholdPx: 128,
  workspaceGrowthStepPx: 256,
  workspaceMaxHeightPx: 6000,
  workspaceAutoScrollEdgePx: 56,
  workspaceAutoScrollStepPx: 12,
  panPointerCount: 2,
} as const;

export const KEYBOARD_VIEWPORT = {
  minimumOcclusionPx: 100,
  editableSelector: 'input:not([type="file"]), textarea, [contenteditable="true"]',
  heightProperty: '--training-viewport-height',
  offsetProperty: '--training-viewport-offset-top',
  keyboardAttribute: 'data-training-keyboard',
} as const;

export const API_ERROR_COPY = {
  request: 'Не получилось связаться с сервером. Попробуй ещё раз',
  timeout: 'Сервер долго не отвечает. Попробуй ещё раз',
} as const;
