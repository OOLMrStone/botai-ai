import type { PipelineFailure } from '@/lib/api/pipeline-console-types';
import type { SolutionDocument } from '@/lib/api/learning-types';
import type {
  ExpertBlockStatus,
  ExpertNativeNumberLine,
  ExpertNativeUnitCircle,
} from '@/config/expert';
import type { TaskBlock } from '@/config/tasks';

export type ExpertCanonicalSign = '+' | '-' | '0' | 'undefined' | 'unknown';
type Marker = 'open' | 'closed' | null;

export type ExpertCanonicalNumericDiagram =
  | {
      type: 'number_line';
      axis_label: string;
      points: {
        id: string;
        value: number;
        label_latex: string;
        marker: Marker;
        sign: ExpertCanonicalSign;
      }[];
      intervals: {
        left_point_id: string | null;
        right_point_id: string | null;
        sign: '+' | '-' | 'unknown';
        selected: boolean;
      }[];
    }
  | {
      type: 'unit_circle';
      points: { id: string; angle_rad: number; label_latex: string; marker: Marker }[];
      arcs: {
        from_point_id: string;
        to_point_id: string;
        direction: 'ccw' | 'cw';
        full_circle: boolean;
        selected: boolean;
      }[];
    };

export type ExpertCanonicalNativeDiagram =
  | (Omit<ExpertNativeNumberLine, 'kind'> & { type: 'number_line_v2' })
  | (Omit<ExpertNativeUnitCircle, 'kind'> & { type: 'unit_circle_v2' });

export type ExpertCanonicalDiagram = ExpertCanonicalNumericDiagram | ExpertCanonicalNativeDiagram;

export type ExpertCanonicalContent =
  | { type: 'text'; text: string }
  | { type: 'math'; latex: string }
  | {
      type: 'step';
      lines: string[];
      image?: { type: 'image'; artifact_id: string; alt: string };
      diagram?: ExpertCanonicalDiagram;
    }
  | ExpertCanonicalNumericDiagram;

export interface ExpertCanonicalBlock {
  id: string;
  title?: string;
  sources: {
    image_id: string;
    bbox: { x: number; y: number; width: number; height: number } | null;
  }[];
  content: ExpertCanonicalContent;
}

export interface ExpertCanonicalBlockReview {
  block_id: string;
  status: ExpertBlockStatus;
  explanation: string | null;
  follows_from_block_ids: string[];
}

export interface ExpertCanonicalFinding {
  id: string;
  block_ids: string[];
  kind: 'error' | 'warning';
  code: string | null;
  description: string;
  where: string | null;
  correct_version: string | null;
  advice: string | null;
  penalty?: number;
}

export interface ExpertCanonicalDocument {
  schema_version: 'expert-review.v1' | 'expert-review.v2';
  origin: 'legacy_adapter' | 'structured_ai' | 'expert';
  phase: 'ocr' | 'analysis' | 'graded' | 'rejected';
  solution_image_ids: string[];
  ocr: { blocks: ExpertCanonicalBlock[] } | null;
  analysis: {
    block_reviews: ExpertCanonicalBlockReview[];
    findings: ExpertCanonicalFinding[];
    summary: string | null;
    checks: {
      domain: { is_correct: boolean; reason: string } | null;
      transformations: { is_correct: boolean; reason: string } | null;
      completeness: { is_complete: boolean; reason: string };
    } | null;
    student_answer: { text: string; is_correct: boolean } | null;
    strengths: string[];
  } | null;
  grading: { score: number; criterion: string; explanation: string } | null;
  rejection_reason: string | null;
}

export interface ExpertStudentDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  contact: string | null;
}

export interface ExpertImageArtifactDto {
  id: string;
  mimeType: 'image/jpeg';
  previewUrl: string;
  width: number;
  height: number;
}

export interface ExpertWorkDto {
  id: string;
  submissionId: string;
  student: ExpertStudentDto;
  taskNumber: number;
  maxScore: number;
  isDemo: boolean;
  status: 'queued' | 'draft' | 'sent';
  gradingStale?: boolean;
  gradeJob?: {
    id: string;
    state: 'queued' | 'pending' | 'succeeded' | 'failed' | 'unknown' | 'stale';
    baseRevision: number;
    preparedRevision: number;
    appliedRevision?: number | null;
    errorCode?: string | null;
    failure?: PipelineFailure | null;
  } | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  task: {
    statement: string;
    content: TaskBlock[] | null;
    referenceAnswer: string | null;
    referenceSolution: string | null;
  };
  images: {
    id: string;
    fileName: string;
    mimeType: string;
    previewUrl: string;
    sourceDocumentId?: string | null;
    pageNumber?: number | null;
  }[];
  documents?: SolutionDocument[];
  imageArtifacts?: ExpertImageArtifactDto[];
  aiResult: ExpertCanonicalDocument;
  review: ExpertCanonicalDocument;
  sentAt: string | null;
}

export interface ExpertPageDto<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface ExpertIdentityDto {
  id: string;
  email: string;
  displayName?: string;
  school: { id: string; name: string };
}
