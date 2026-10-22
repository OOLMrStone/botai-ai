import {
  EXPERT,
  EXPERT_COPY,
  EXPERT_ARTIFACT_URL_PATTERN,
  type ExpertBlock,
  type ExpertDiagram,
  type ExpertNumericDiagram,
  type ExpertNumberLine,
  type ExpertStudent,
  type ExpertTask,
  type ExpertUnitCircle,
  type ExpertWork,
} from '@/config/expert';
import { EXPERIMENTAL_STUDENTS } from '@/config/experimental';
import { ApiError } from '@/lib/api/client';
import type {
  ExpertCanonicalBlock,
  ExpertCanonicalBlockReview,
  ExpertCanonicalContent,
  ExpertCanonicalDiagram,
  ExpertCanonicalNumericDiagram,
  ExpertCanonicalDocument,
  ExpertStudentDto,
  ExpertWorkDto,
  ExpertImageArtifactDto,
} from '@/lib/api/expert-types';
import {
  expertInitials,
  sameExpertData,
  validateExpertDiagram,
  validateExpertFindingDeduction,
} from '@/lib/expert';

export function expertStudentFromDto(student: ExpertStudentDto): ExpertStudent {
  const name =
    [student.firstName, student.lastName].filter(Boolean).join(' ') || student.email || student.id;

  return {
    id: student.id,
    name,
    initials: expertInitials(name),
    email: student.email ?? '',
    contact: student.contact ?? '',
  };
}

export function expertDocument(value: unknown): ExpertCanonicalDocument {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schema_version' in value) ||
    !EXPERT.schemaVersions.some((version) => version === value.schema_version) ||
    !('ocr' in value) ||
    !('analysis' in value) ||
    'blocks' in value ||
    'findings' in value
  ) {
    throw new ApiError(502, EXPERT_COPY.errors.invalidData);
  }
  const document = value as ExpertCanonicalDocument;
  if (document.phase === 'rejected') {
    if (
      document.ocr !== null ||
      document.analysis !== null ||
      document.grading !== null ||
      !document.rejection_reason
    )
      throw new ApiError(502, EXPERT_COPY.errors.invalidData);
    return document;
  }
  if (
    !document.ocr ||
    !Array.isArray(document.ocr.blocks) ||
    !document.analysis ||
    !Array.isArray(document.analysis.block_reviews) ||
    !Array.isArray(document.analysis.findings)
  ) {
    throw new ApiError(502, EXPERT_COPY.errors.invalidData);
  }
  const ids = document.ocr.blocks.map((block) => block.id);
  const invalidStep = document.ocr.blocks.some((block) => {
    if (
      block.title !== undefined &&
      (typeof block.title !== 'string' || block.title.length > EXPERT.structuredStep.maxTitleLength)
    )
      return true;
    const contentType: unknown = block.content.type;
    if (contentType === 'number_line_v2' || contentType === 'unit_circle_v2') return true;
    if (block.content.type !== 'step') return false;
    const { lines, image, diagram } = block.content;

    return (
      document.schema_version === 'expert-review.v1' ||
      !Array.isArray(lines) ||
      lines.length > EXPERT.structuredStep.maxLines ||
      lines.some(
        (line) => typeof line !== 'string' || line.length > EXPERT.structuredStep.maxLineLength,
      ) ||
      (!lines.some((line) => line.trim()) && !image && !diagram) ||
      (image !== undefined && diagram !== undefined) ||
      (diagram !== undefined && !validCanonicalDiagram(diagram)) ||
      (image !== undefined &&
        (image.type !== 'image' ||
          typeof image.artifact_id !== 'string' ||
          !image.artifact_id ||
          typeof image.alt !== 'string' ||
          image.alt.length > EXPERT.structuredStep.maxTitleLength))
    );
  });
  const reviews = document.analysis.block_reviews.map((review) => review.block_id);
  if (
    invalidStep ||
    document.analysis.findings.some(
      (finding) =>
        finding.penalty !== undefined &&
        (document.schema_version !== 'expert-review.v2' ||
          !Number.isInteger(finding.penalty) ||
          finding.penalty < EXPERT.minScore),
    ) ||
    new Set(ids).size !== ids.length ||
    new Set(reviews).size !== reviews.length ||
    ids.length !== reviews.length ||
    reviews.some((id) => !ids.includes(id))
  ) {
    throw new ApiError(502, EXPERT_COPY.errors.invalidData);
  }

  return document;
}

export function expertBlockFromCanonical(
  block: ExpertCanonicalBlock,
  index: number,
  review: ExpertCanonicalBlockReview,
  artifacts: ExpertImageArtifactDto[] = [],
): ExpertBlock {
  const common = {
    id: block.id,
    title: block.title?.trim() ? block.title : EXPERT_COPY.blockTitle(index),
    status: review.status,
    explanation: review.explanation ?? '',
    followsFromBlockIds: [...review.follows_from_block_ids],
  };
  const content = block.content;
  if (content.type === 'text') return { ...common, kind: 'text', text: content.text };
  if (content.type === 'math') return { ...common, kind: 'math', formulas: [content.latex] };
  if (content.type === 'step') {
    const artifact = artifacts.find((item) => item.id === content.image?.artifact_id);
    const available =
      artifact &&
      EXPERT_ARTIFACT_URL_PATTERN.test(artifact.previewUrl) &&
      Number.isFinite(artifact.width) &&
      artifact.width > 0 &&
      Number.isFinite(artifact.height) &&
      artifact.height > 0;
    return {
      ...common,
      kind: 'step',
      lines: [...content.lines],
      ...(content.image
        ? {
            image: {
              id: content.image.artifact_id,
              alt: content.image.alt,
              url: available ? artifact.previewUrl : null,
              ...(available ? { width: artifact.width, height: artifact.height } : {}),
            },
          }
        : {}),
      ...(content.diagram ? { diagram: diagramFromCanonical(content.diagram) } : {}),
    };
  }

  return { ...common, ...diagramFromCanonical(content) };
}

function validCanonicalDiagram(content: ExpertCanonicalDiagram): boolean {
  try {
    if ('kind' in content) return false;
    return validateExpertDiagram(diagramFromCanonical(content)) === null;
  } catch {
    return false;
  }
}

function diagramFromCanonical(content: ExpertCanonicalNumericDiagram): ExpertNumericDiagram;
function diagramFromCanonical(content: ExpertCanonicalDiagram): ExpertDiagram;
function diagramFromCanonical(content: ExpertCanonicalDiagram): ExpertDiagram {
  if (content.type === 'number_line_v2') {
    const { type, ...diagram } = structuredClone(content);
    return { kind: type, ...diagram };
  }
  if (content.type === 'unit_circle_v2') {
    const { type, ...diagram } = structuredClone(content);
    return { kind: type, ...diagram };
  }
  if (content.type === 'number_line') {
    const values = content.points.map((point) => point.value);
    const padding = Math.max(
      EXPERT.diagramPadding,
      (Math.max(...values) - Math.min(...values)) / EXPERT.diagramPadding,
    );
    const pointValue = (id: string | null) =>
      id === null ? null : (content.points.find((point) => point.id === id)?.value ?? null);

    return {
      kind: 'number_line',
      axis: {
        label: content.axis_label,
        min: values.length ? Math.min(...values) - padding : -EXPERT.diagramPadding,
        max: values.length ? Math.max(...values) + padding : EXPERT.diagramPadding,
        points: content.points.map((point) => ({
          id: point.id,
          value: point.value,
          label: point.label_latex,
          included: point.marker === 'closed',
          marker: point.marker,
          sign: point.sign === 'undefined' || point.sign === 'unknown' ? null : point.sign,
        })),
        intervals: content.intervals.map((interval, intervalIndex) => ({
          id: String(intervalIndex),
          from: pointValue(interval.left_point_id),
          to: pointValue(interval.right_point_id),
          sign: interval.sign === 'unknown' ? null : interval.sign,
          selected: interval.selected,
        })),
        selectedPoints: content.points
          .filter((point) => point.marker === 'closed')
          .map((point) => point.id),
        domain: null,
      },
    };
  }
  if (content.type === 'unit_circle') {
    return {
      kind: 'unit_circle',
      circle: {
        points: content.points.map((point) => ({
          id: point.id,
          angle: point.angle_rad,
          label: point.label_latex,
          selected: point.marker === 'closed',
          marker: point.marker,
        })),
        arcs: content.arcs.map((arc, arcIndex) => ({
          id: String(arcIndex),
          from: content.points.find((point) => point.id === arc.from_point_id)!.angle_rad,
          to: content.points.find((point) => point.id === arc.to_point_id)!.angle_rad,
          fromPointId: arc.from_point_id,
          toPointId: arc.to_point_id,
          fullCircle: arc.full_circle,
          direction: arc.direction,
          selected: arc.selected,
        })),
      },
    };
  }

  throw new ApiError(502, EXPERT_COPY.errors.invalidData);
}

function submittedLabel(minutes: number): string {
  const format = new Intl.RelativeTimeFormat(EXPERT.locale, { numeric: 'auto' });
  if (minutes >= EXPERT.minutesPerDay)
    return format.format(-Math.floor(minutes / EXPERT.minutesPerDay), 'day');
  if (minutes >= EXPERT.minutesPerHour)
    return format.format(-Math.floor(minutes / EXPERT.minutesPerHour), 'hour');

  return format.format(-minutes, 'minute');
}

function originalDocumentForImage(work: ExpertWorkDto, documentId?: string | null) {
  const document = work.documents?.find(
    (candidate) => candidate.id === documentId && candidate.state === 'ready',
  );
  return document?.downloadUrl
    ? {
        originalDocument: {
          id: document.id,
          name: document.fileName,
          mimeType: document.mimeType,
          downloadUrl: document.downloadUrl,
        },
      }
    : {};
}

export function expertWorkFromDto(work: ExpertWorkDto): ExpertWork {
  const document = expertDocument(work.review ?? work.aiResult);
  const student = expertStudentFromDto(work.student);
  const submittedAgoMinutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(work.createdAt)) / EXPERT.minutesInMillisecond),
  );
  const task: ExpertTask = {
    id: work.id,
    number: work.taskNumber,
    title: EXPERT_COPY.taskTitle,
    statement: work.task.statement,
    statementContent: work.task.content ?? undefined,
    sourceImage: work.images[0]?.previewUrl ?? null,
    sourceImages: work.images.map((image) => ({
      id: image.id,
      url: image.previewUrl,
      name: image.fileName,
      mimeType: image.mimeType,
      sourceDocumentId: image.sourceDocumentId,
      pageNumber: image.pageNumber,
      ...originalDocumentForImage(work, image.sourceDocumentId),
    })),
    blocks:
      document.ocr?.blocks.map((block, index) =>
        expertBlockFromCanonical(
          block,
          index,
          document.analysis!.block_reviews.find((review) => review.block_id === block.id)!,
          work.imageArtifacts,
        ),
      ) ?? [],
    analysis: {
      score: document.grading?.score ?? EXPERT.minScore,
      hasGrade: document.grading !== null,
      gradeStale: work.gradingStale ?? false,
      maxScore: work.maxScore,
      verdict: document.grading?.explanation ?? document.analysis?.summary ?? '',
      summary: document.analysis?.summary ?? '',
      findings: (document.analysis?.findings ?? []).map((finding) => ({
        id: finding.id,
        kind: finding.kind,
        blockId: finding.block_ids[0] ?? '',
        title: finding.where ?? EXPERT_COPY.generalFinding,
        description: finding.description,
        ...(finding.penalty !== undefined ? { deduction: finding.penalty } : {}),
      })),
      advice: (document.analysis?.findings ?? [])
        .map((finding) => finding.advice)
        .filter(Boolean)
        .join('\n\n'),
      criterion: document.grading?.criterion ?? '',
      correctAnswer: work.task.referenceAnswer ?? '',
      ...(document.phase === 'rejected' ? { rejectedReason: document.rejection_reason ?? '' } : {}),
    },
    approved: work.status === 'sent',
    updatedByExpert: document.origin === 'expert',
    revision: work.revision,
    readOnly: work.status === 'sent',
    ...(work.gradeJob
      ? {
          gradingJob: {
            id: work.gradeJob.id,
            state: work.gradeJob.state,
            errorCode: work.gradeJob.errorCode,
            failure: work.gradeJob.failure,
          },
        }
      : {}),
    backend: { document: structuredClone(document), phase: document.phase, workId: work.id },
  };

  if (task.analysis.findings.some((finding) => validateExpertFindingDeduction(task, finding)))
    throw new ApiError(502, EXPERT_COPY.errors.invalidData);

  return {
    id: work.id,
    studentId: student.id,
    student,
    subject: EXPERIMENTAL_STUDENTS[0].subject,
    submittedAt: submittedLabel(submittedAgoMinutes),
    submittedAgoMinutes,
    status: work.status === 'sent' ? 'reviewed' : 'pending',
    tasks: [task],
  };
}

function lineContent(
  axis: ExpertNumberLine,
  original?: ExpertCanonicalDiagram,
): ExpertCanonicalNumericDiagram {
  const baseline = original?.type === 'number_line' ? original : null;
  const sorted = [...axis.points].sort((first, second) => first.value - second.value);
  const pointId = (value: number | null) => {
    if (value === null) return null;
    const point = sorted.find((candidate) => candidate.value === value);
    if (!point) throw new ApiError(422, EXPERT_COPY.errors.geometry);

    return point.id;
  };

  return {
    type: 'number_line',
    axis_label: axis.label,
    points: sorted.map((point) => {
      const previous = baseline?.points.find((candidate) => candidate.id === point.id);
      const marker =
        point.marker !== undefined
          ? point.marker
          : previous && (previous.marker === 'closed') === point.included
            ? previous.marker
            : point.included
              ? 'closed'
              : 'open';
      const sign = point.sign ?? (previous?.sign === 'undefined' ? 'undefined' : 'unknown');

      return { id: point.id, value: point.value, label_latex: point.label, marker, sign };
    }),
    intervals: axis.intervals.map((interval) => ({
      left_point_id: pointId(interval.from),
      right_point_id: pointId(interval.to),
      sign: interval.sign === '+' || interval.sign === '-' ? interval.sign : 'unknown',
      selected: interval.selected,
    })),
  };
}

function circleContent(
  circle: ExpertUnitCircle,
  original?: ExpertCanonicalDiagram,
): ExpertCanonicalNumericDiagram {
  const baseline = original?.type === 'unit_circle' ? original : null;
  const pointId = (angle: number, explicitId?: string, previousId?: string) => {
    if (explicitId !== undefined) {
      if (!circle.points.some((candidate) => candidate.id === explicitId))
        throw new ApiError(422, EXPERT_COPY.errors.unsupportedGeometry);
      return explicitId;
    }
    const previous = circle.points.find(
      (candidate) => candidate.id === previousId && candidate.angle === angle,
    );
    const point = previous ?? circle.points.find((candidate) => candidate.angle === angle);
    if (!point) throw new ApiError(422, EXPERT_COPY.errors.unsupportedGeometry);

    return point.id;
  };

  return {
    type: 'unit_circle',
    points: circle.points.map((point) => {
      const previous = baseline?.points.find((candidate) => candidate.id === point.id);
      const marker =
        point.marker !== undefined
          ? point.marker
          : previous && (previous.marker === 'closed') === point.selected
            ? previous.marker
            : point.selected
              ? 'closed'
              : 'open';

      return {
        id: point.id,
        angle_rad:
          point.angle >= 0 && point.angle < EXPERT.radiansInTurn
            ? point.angle
            : ((point.angle % EXPERT.radiansInTurn) + EXPERT.radiansInTurn) % EXPERT.radiansInTurn,
        label_latex: point.label,
        marker,
      };
    }),
    arcs: circle.arcs.map((arc) => {
      const previous = baseline?.arcs[Number(arc.id)];
      const from = pointId(arc.from, arc.fromPointId, previous?.from_point_id);
      const to = pointId(arc.to, arc.toPointId, previous?.to_point_id);

      return {
        from_point_id: from,
        to_point_id: to,
        direction: arc.direction,
        full_circle: arc.fullCircle ?? from === to,
        selected: arc.selected,
      };
    }),
  };
}

function diagramContent(
  diagram: ExpertNumericDiagram,
  original?: ExpertCanonicalDiagram,
): ExpertCanonicalNumericDiagram;
function diagramContent(
  diagram: ExpertDiagram,
  original?: ExpertCanonicalDiagram,
): ExpertCanonicalDiagram;
function diagramContent(
  diagram: ExpertDiagram,
  original?: ExpertCanonicalDiagram,
): ExpertCanonicalDiagram {
  const error = validateExpertDiagram(diagram);
  if (error) throw new ApiError(422, error);
  if (original && sameExpertData(diagram, diagramFromCanonical(original)))
    return structuredClone(original);
  if (diagram.kind === 'number_line_v2') {
    const { kind, ...content } = structuredClone(diagram);
    return { type: kind, ...content };
  }
  if (diagram.kind === 'unit_circle_v2') {
    const { kind, ...content } = structuredClone(diagram);
    return { type: kind, ...content };
  }

  return diagram.kind === 'number_line'
    ? lineContent(diagram.axis, original)
    : circleContent(diagram.circle, original);
}

function contentForBlock(
  block: ExpertBlock,
  original: ExpertCanonicalContent,
): ExpertCanonicalContent {
  if (block.kind === 'text') return { type: 'text', text: block.text };
  if (block.kind === 'math')
    return {
      type: 'math',
      latex:
        block.formulas.length === 1
          ? block.formulas[0]
          : `\\begin{gathered}${block.formulas.join('\\\\')}\\end{gathered}`,
    };
  if (block.kind === 'step') {
    if (block.image && block.diagram) throw new ApiError(422, EXPERT_COPY.errors.geometry);

    return {
      type: 'step',
      lines: [...block.lines],
      ...(block.image
        ? { image: { type: 'image', artifact_id: block.image.id, alt: block.image.alt } }
        : {}),
      ...(block.diagram
        ? {
            diagram: diagramContent(
              block.diagram,
              original.type === 'step' ? original.diagram : undefined,
            ),
          }
        : {}),
    };
  }

  return diagramContent(
    block,
    original.type === 'number_line' || original.type === 'unit_circle' ? original : undefined,
  );
}

function blockContentView(block: ExpertBlock): unknown {
  if (block.kind === 'text') return { kind: block.kind, text: block.text };
  if (block.kind === 'math') return { kind: block.kind, formulas: block.formulas };
  if (block.kind === 'number_line') return { kind: block.kind, axis: block.axis };
  if (block.kind === 'step')
    return {
      kind: block.kind,
      lines: block.lines,
      image: block.image ? { id: block.image.id, alt: block.image.alt } : undefined,
      diagram: block.diagram,
    };

  return { kind: block.kind, circle: block.circle };
}

export function expertTaskToCanonical(task: ExpertTask): ExpertCanonicalDocument {
  const original = expertDocument(task.backend?.document);
  if (task.readOnly) throw new ApiError(409, EXPERT_COPY.errors.readOnly);
  if (
    original.schema_version === 'expert-review.v1' &&
    task.blocks.some((block) => block.kind === 'step')
  )
    throw new ApiError(422, EXPERT_COPY.errors.geometry);
  if (original.phase === 'rejected' && task.analysis.rejectedReason) {
    return {
      ...structuredClone(original),
      origin: 'expert',
      rejection_reason: task.analysis.rejectedReason,
    };
  }
  const originalBlocks = original.ocr?.blocks ?? [];
  const originalReviews = original.analysis?.block_reviews ?? [];
  const originalFindings = original.analysis?.findings ?? [];
  const blocks = task.blocks.map((block) => {
    const previous = originalBlocks.find((candidate) => candidate.id === block.id);
    const previousReview = originalReviews.find((review) => review.block_id === block.id);
    if (!previous || !previousReview) throw new ApiError(422, EXPERT_COPY.errors.block);
    const baseline = expertBlockFromCanonical(
      previous,
      originalBlocks.indexOf(previous),
      previousReview,
    );
    const contentChanged =
      JSON.stringify(blockContentView(block)) !== JSON.stringify(blockContentView(baseline));

    return {
      ...structuredClone(previous),
      ...(block.title !== baseline.title ? { title: block.title } : {}),
      content: contentChanged
        ? contentForBlock(block, previous.content)
        : structuredClone(previous.content),
    };
  });
  const reviewsById = new Map(
    task.blocks.map((block, index) => {
      const previous = originalReviews.find((review) => review.block_id === block.id);
      const follows =
        block.status === 'follow_through'
          ? (block.followsFromBlockIds ?? previous?.follows_from_block_ids ?? [])
          : [];
      if (
        block.status === 'follow_through' &&
        (!follows.length ||
          follows.some(
            (id) =>
              !task.blocks
                .slice(0, index)
                .some((candidate) => candidate.id === id && candidate.status === 'error'),
          ))
      ) {
        throw new ApiError(422, EXPERT_COPY.errors.followThrough);
      }
      const unchanged =
        previous &&
        previous.status === block.status &&
        (previous.explanation ?? '') === block.explanation &&
        JSON.stringify(previous.follows_from_block_ids) === JSON.stringify(follows);

      return [
        block.id,
        unchanged
          ? structuredClone(previous)
          : {
              block_id: block.id,
              status: block.status,
              explanation: block.explanation || null,
              follows_from_block_ids: [...follows],
            },
      ];
    }),
  );
  // Порядок reviews не связан с OCR; неизменённый документ возвращается без перестановки.
  const reviews = originalReviews
    .map((review) => reviewsById.get(review.block_id))
    .filter((review): review is ExpertCanonicalBlockReview => !!review);
  const findings = task.analysis.findings.map((finding) => {
    const deductionError = validateExpertFindingDeduction(task, finding);
    if (deductionError) throw new ApiError(422, deductionError);
    const previous = originalFindings.find((candidate) => candidate.id === finding.id);
    const unchangedTarget = previous?.block_ids[0] === (finding.blockId || undefined);

    return {
      id: finding.id,
      block_ids: unchangedTarget
        ? [...(previous?.block_ids ?? [])]
        : finding.blockId
          ? [...new Set([finding.blockId, ...(previous?.block_ids.slice(1) ?? [])])]
          : [],
      kind: finding.kind ?? previous?.kind ?? ('error' as const),
      code: previous?.code ?? null,
      description: finding.description,
      where:
        finding.title === (previous?.where ?? EXPERT_COPY.generalFinding)
          ? (previous?.where ?? null)
          : finding.title || null,
      correct_version: previous?.correct_version ?? null,
      advice: previous?.advice ?? null,
      ...(finding.deduction !== undefined ? { penalty: finding.deduction } : {}),
    };
  });
  const previousAdvice = originalFindings
    .map((finding) => finding.advice)
    .filter(Boolean)
    .join('\n\n');
  if (task.analysis.advice !== previousAdvice) {
    if (findings.length) {
      findings.forEach((finding, index) => {
        finding.advice = index === 0 ? task.analysis.advice || null : null;
      });
    } else if (task.analysis.advice.trim()) {
      findings.push({
        id: 'expert-advice',
        block_ids: [],
        kind: 'warning',
        code: null,
        description: task.analysis.advice,
        where: null,
        correct_version: null,
        advice: task.analysis.advice,
      });
    }
  }
  const hasGrade = task.analysis.hasGrade !== false;
  const hasAnalysis =
    reviews.some((review) => review.status !== null) ||
    findings.length > 0 ||
    !!original.analysis?.summary;

  return {
    ...structuredClone(original),
    origin: 'expert',
    phase: hasGrade ? 'graded' : hasAnalysis ? 'analysis' : original.phase,
    ocr: { blocks },
    analysis: {
      block_reviews: reviews,
      summary: original.analysis?.summary ?? null,
      checks: original.analysis?.checks ? structuredClone(original.analysis.checks) : null,
      student_answer: original.analysis?.student_answer
        ? structuredClone(original.analysis.student_answer)
        : null,
      strengths: [...(original.analysis?.strengths ?? [])],
      findings,
    },
    grading: hasGrade
      ? {
          score: task.analysis.score,
          criterion: task.analysis.criterion,
          explanation: task.analysis.verdict,
        }
      : null,
    rejection_reason: null,
  };
}
