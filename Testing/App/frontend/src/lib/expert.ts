import {
  EXPERT,
  EXPERT_COPY,
  EXPERT_WORK_STATUSES,
  type ExpertBlock,
  type ExpertDiagram,
  type ExpertFinding,
  type ExpertQueueFilter,
  type ExpertQueueSort,
  type ExpertTask,
  type ExpertWork,
} from '@/config/expert';
import { EXPERT_FINDING_REVIEW } from '@/config/expert-causality';
import type { PipelineFailure } from '@/lib/api/pipeline-console-types';
import { pipelineFailureLabel } from '@/lib/pipeline-console';
import { gridErrorSources } from '@/lib/grid-view';

export function getExpertQueue(
  works: ExpertWork[],
  query: string,
  sort: ExpertQueueSort,
  filter: ExpertQueueFilter,
): ExpertWork[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  const direction = sort === 'oldest' ? -1 : 1;

  return works
    .filter(
      (work) =>
        work.status === filter &&
        terms.every((term) =>
          `${work.student.name} ${work.student.id} ${work.student.email}`
            .toLocaleLowerCase()
            .includes(term),
        ),
    )
    .sort((first, second) => (first.submittedAgoMinutes - second.submittedAgoMinutes) * direction);
}

export function expertInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase();
}

export function replaceExpertTask(work: ExpertWork, task: ExpertTask): ExpertWork {
  const tasks = work.tasks.map((current) => (current.id === task.id ? task : current));

  return {
    ...work,
    tasks,
    status: tasks.every((current) => current.approved) ? 'reviewed' : 'pending',
  };
}

export function isExpertTaskDirty(task: ExpertTask | null, saved: ExpertTask | null): boolean {
  return !!task && !!saved && JSON.stringify(task) !== JSON.stringify(saved);
}

export function validateExpertBlock(block: ExpertBlock): string | null {
  if (!block.title.trim()) return EXPERT_COPY.errors.block;
  if (block.kind === 'text') return block.text.trim() ? null : EXPERT_COPY.errors.block;
  if (block.kind === 'step') {
    if (block.image && block.diagram) return EXPERT_COPY.errors.geometry;
    if (!block.lines.some((line) => line.trim()) && !block.image?.id && !block.diagram)
      return EXPERT_COPY.errors.block;

    return block.diagram ? validateExpertDiagram(block.diagram) : null;
  }
  if (block.kind === 'math') {
    return block.formulas.length && block.formulas.every((formula) => formula.trim())
      ? null
      : EXPERT_COPY.errors.block;
  }

  return validateExpertDiagram(block);
}

export function validateExpertDiagram(diagram: ExpertDiagram): string | null {
  if (diagram.kind === 'number_line_v2' || diagram.kind === 'unit_circle_v2')
    return validNativeDiagram(diagram) ? null : EXPERT_COPY.errors.geometry;
  if (diagram.kind === 'unit_circle') {
    const valid =
      diagram.circle.points.every(
        (point) => Number.isFinite(point.angle) && typeof point.label === 'string',
      ) && diagram.circle.arcs.every((arc) => Number.isFinite(arc.from) && Number.isFinite(arc.to));
    return valid ? null : EXPERT_COPY.errors.geometry;
  }

  const { axis } = diagram;
  const ids = axis.points.map((point) => point.id);
  const validBound = (value: number | null) => value === null || Number.isFinite(value);
  const valid =
    Number.isFinite(axis.min) &&
    Number.isFinite(axis.max) &&
    axis.min < axis.max &&
    new Set(ids).size === ids.length &&
    new Set(axis.points.map((point) => point.value)).size === axis.points.length &&
    axis.points.every(
      (point) =>
        Number.isFinite(point.value) &&
        point.value >= axis.min &&
        point.value <= axis.max &&
        typeof point.label === 'string' &&
        (point.marker === undefined || (point.marker === 'closed') === point.included),
    ) &&
    axis.intervals.every(
      (interval) =>
        validBound(interval.from) &&
        validBound(interval.to) &&
        (interval.from === null || interval.to === null || interval.from < interval.to),
    ) &&
    axis.selectedPoints.every((id) =>
      axis.points.some((point) => point.id === id && point.included),
    ) &&
    (!axis.domain ||
      (validBound(axis.domain.from) &&
        validBound(axis.domain.to) &&
        (axis.domain.from === null ||
          axis.domain.to === null ||
          axis.domain.from < axis.domain.to)));

  return valid ? null : EXPERT_COPY.errors.geometry;
}

function nativeFields(
  value: unknown,
  required: string[],
  optional: string[] = [],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

function nativeText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= limit;
}

function nativeSign(value: unknown): boolean {
  return value === null || EXPERT.nativeDiagram.signs.some((sign) => sign === value);
}

function validNativeDiagram(value: unknown): boolean {
  const numberLine =
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'number_line_v2';
  const limits = EXPERT.nativeDiagram;
  if (
    !nativeFields(
      value,
      numberLine ? ['kind', 'variable', 'note', 'points', 'arcs'] : ['kind', 'points', 'arcs'],
    )
  )
    return false;
  if (!numberLine && value.kind !== 'unit_circle_v2') return false;
  if (
    numberLine &&
    (!nativeText(value.variable, limits.maxVariableLength) ||
      (value.note !== null && !nativeText(value.note, limits.maxNoteLength)))
  )
    return false;
  if (
    !Array.isArray(value.points) ||
    value.points.length > limits.maxPoints ||
    !Array.isArray(value.arcs) ||
    value.arcs.length > limits.maxArcs
  )
    return false;
  const ids = new Set<string>();
  for (const point of value.points) {
    if (
      !nativeFields(point, ['id', 'value', 'included', 'sign'], ['bound']) ||
      !nativeText(point.id, limits.maxIdLength) ||
      ids.has(point.id) ||
      limits.infinityEndpoints.some((end) => end === point.id) ||
      !nativeText(point.value, limits.maxValueLength) ||
      !nativeSign(point.sign) ||
      ('bound' in point && typeof point.bound !== 'boolean') ||
      (typeof point.included !== 'boolean' && !(point.bound === true && point.included === null))
    )
      return false;
    ids.add(point.id);
  }
  const endpoint = (reference: unknown) =>
    typeof reference === 'string' &&
    (ids.has(reference) ||
      (numberLine && limits.infinityEndpoints.some((end) => end === reference)));

  return value.arcs.every((arc) => {
    if (
      !nativeFields(
        arc,
        numberLine
          ? ['from', 'to', 'sign', 'selected']
          : ['from', 'to', 'sign', 'selected', 'direction', 'full_circle'],
      ) ||
      !endpoint(arc.from) ||
      !endpoint(arc.to) ||
      !nativeSign(arc.sign) ||
      typeof arc.selected !== 'boolean'
    )
      return false;

    return (
      numberLine ||
      ((arc.direction === 'cw' || arc.direction === 'ccw') &&
        typeof arc.full_circle === 'boolean' &&
        arc.full_circle === (arc.from === arc.to))
    );
  });
}

export function validateExpertBlockCauses(task: ExpertTask, block: ExpertBlock): string | null {
  const causes = block.followsFromBlockIds ?? [];
  if (block.status !== 'follow_through') {
    return causes.length ? EXPERT_COPY.errors.followThrough : null;
  }

  const sources = gridErrorSources(task, block.id);
  const valid =
    causes.length > 0 && causes.every((id) => sources.some((candidate) => candidate.id === id));

  return valid ? null : EXPERT_COPY.errors.followThrough;
}

export function supportsExpertFindingDeductions(task: ExpertTask): boolean {
  if (!task.backend) return true;
  const document = task.backend.document;

  return (
    !!document &&
    typeof document === 'object' &&
    'schema_version' in document &&
    document.schema_version === 'expert-review.v2'
  );
}

export function validateExpertFindingDeduction(
  task: ExpertTask,
  finding: ExpertFinding,
): string | null {
  const penalty = finding.deduction;
  if (penalty === undefined) return null;
  if (!supportsExpertFindingDeductions(task)) return EXPERT_COPY.errors.unsupportedDeduction;
  if (!Number.isInteger(penalty) || penalty < EXPERT.minScore || penalty > task.analysis.maxScore)
    return EXPERT_COPY.errors.deduction;
  const status = task.blocks.find((block) => block.id === finding.blockId)?.status;
  if (
    penalty > EXPERT.minScore &&
    (finding.kind === 'warning' || status === 'warning' || status === 'follow_through')
  )
    return EXPERT_COPY.errors.deductionCause;

  return null;
}

export function validateExpertTask(task: ExpertTask): string | null {
  if (task.analysis.rejectedReason) return null;
  const { score, maxScore, findings } = task.analysis;
  if (
    task.analysis.hasGrade !== false &&
    (!Number.isInteger(score) ||
      !Number.isInteger(maxScore) ||
      maxScore < EXPERT.minScore ||
      score < EXPERT.minScore ||
      score > maxScore)
  ) {
    return EXPERT_COPY.errors.score;
  }
  const invalidCause = task.blocks.some((block) => validateExpertBlockCauses(task, block));
  if (invalidCause) return EXPERT_COPY.errors.followThrough;
  const blockError = task.blocks.map(validateExpertBlock).find(Boolean);
  if (blockError) return blockError;
  const deductionError = findings
    .map((finding) => validateExpertFindingDeduction(task, finding))
    .find(Boolean);
  if (deductionError) return deductionError;
  if (
    (!task.blocks.length && task.backend?.phase !== 'rejected') ||
    new Set(task.blocks.map((block) => block.id)).size !== task.blocks.length
  )
    return EXPERT_COPY.errors.block;
  if (
    findings.some(
      (finding) => finding.blockId && !task.blocks.some((block) => block.id === finding.blockId),
    )
  )
    return EXPERT_COPY.errors.findings;

  return null;
}

export function validateExpertApproval(task: ExpertTask): string | null {
  if (task.readOnly) return EXPERT_COPY.errors.readOnly;
  if (task.analysis.rejectedReason) return null;
  if (expertTaskNeedsReview(task)) return EXPERT_FINDING_REVIEW.footer;
  if (task.analysis.hasGrade === false) return EXPERT_COPY.errors.missingGrade;
  if (task.analysis.gradeStale) return EXPERT_COPY.errors.staleGrade;

  return validateExpertTask(task);
}

export function sameExpertData(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (first === null || second === null || typeof first !== 'object' || typeof second !== 'object')
    return false;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((value, index) => sameExpertData(value, second[index]))
    );
  }
  const firstEntries = Object.entries(first);
  const secondEntries = Object.entries(second);

  return (
    firstEntries.length === secondEntries.length &&
    firstEntries.every(([key, value]) =>
      secondEntries.some(
        ([otherKey, otherValue]) => key === otherKey && sameExpertData(value, otherValue),
      ),
    )
  );
}

export function expertGradeActive(state: string | undefined) {
  return EXPERT.activeGradeStates.some((active) => active === state);
}

export function expertGradeFailure(failure?: PipelineFailure | null) {
  return pipelineFailureLabel(failure) || EXPERT_COPY.errors.gradeFailed;
}

export function expertGradeFeedback(state: string | undefined, failure?: PipelineFailure | null) {
  if (state === 'queued') return EXPERT_COPY.gradeQueued;
  if (state === 'pending') return EXPERT_COPY.gradePending;
  if (state === 'unknown')
    return EXPERT_COPY.gradeUncertain(EXPERT_COPY.gradeUnknown, pipelineFailureLabel(failure));
  return EXPERT_COPY.graded;
}

export function expertWorkStatus(work: ExpertWork) {
  if (work.status === 'reviewed') return EXPERT_WORK_STATUSES.reviewed;
  if (work.tasks.some((task) => task.gradingJob?.state === 'queued'))
    return EXPERT_WORK_STATUSES.gradingQueued;
  if (work.tasks.some((task) => task.gradingJob?.state === 'pending'))
    return EXPERT_WORK_STATUSES.grading;
  if (work.tasks.some((task) => task.gradingJob?.state === 'unknown'))
    return EXPERT_WORK_STATUSES.unknown;
  if (work.tasks.some((task) => task.gradingJob?.state === 'failed'))
    return EXPERT_WORK_STATUSES.failed;
  if (work.tasks.some((task) => task.analysis.rejectedReason)) return EXPERT_WORK_STATUSES.rejected;
  if (work.tasks.some((task) => task.analysis.gradeStale)) return EXPERT_WORK_STATUSES.stale;
  if (
    work.tasks.some(
      (task) =>
        task.analysis.hasGrade === false ||
        task.backend?.phase === 'ocr' ||
        task.backend?.phase === 'analysis',
    )
  )
    return EXPERT_WORK_STATUSES.ocr;

  return EXPERT_WORK_STATUSES.ready;
}

export function expertFindingNeedsReview(task: ExpertTask, finding: ExpertFinding): boolean {
  if (finding.title === EXPERT_FINDING_REVIEW.title) return true;
  if (!finding.blockId || finding.kind === 'warning') return false;
  const block = task.blocks.find((candidate) => candidate.id === finding.blockId);

  return !block || block.status === 'correct' || block.status === 'warning';
}

export function expertTaskNeedsReview(task: ExpertTask): boolean {
  return task.analysis.findings.some((finding) => expertFindingNeedsReview(task, finding));
}
