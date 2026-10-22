import type { B2B_TASK_NUMBERS } from '@/config/b2b';
import type { TaskBlock } from '@/config/tasks';
import type { ExpertCanonicalDocument, ExpertImageArtifactDto } from '@/lib/api/expert-types';
import type { Attachment, Page, SolutionDocument } from '@/lib/api/learning-types';

export type PipelineTaskNumber = (typeof B2B_TASK_NUMBERS)[number];
export type PipelineRunState =
  | 'preparing'
  | 'queued'
  | 'running'
  | 'completed'
  | 'awaiting_expert'
  | 'reviewing'
  | 'returned'
  | 'failed'
  | 'unknown'
  | 'cancelled';

export type PipelineFailureCategory =
  'model_response' | 'network' | 'provider' | 'configuration' | 'input' | 'timeout' | 'internal';

export interface PipelineFailure {
  category: PipelineFailureCategory;
  diagnosticCode: number;
  reasonCode: string;
  phase: string;
  step?: string;
  attempt?: number;
  maxAttempts?: number;
  failureCounts?: Partial<Record<PipelineFailureCategory, number>>;
  retryable?: boolean;
  exhausted?: boolean;
  issueCodes?: string[];
  issuePaths?: string[];
}

export interface PipelineRunSummary {
  id: string;
  origin: 'school' | 'manual';
  submissionId: string;
  assignmentId: string | null;
  workId: string | null;
  taskNumber: PipelineTaskNumber;
  state: PipelineRunState;
  phase: string;
  revision: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  failure?: PipelineFailure | null;
}

export interface PipelineArtifact {
  id: string;
  kind: 'ocr' | 'analysis' | 'grading' | 'task_input';
  state: 'available' | 'unavailable';
  document: Record<string, unknown> | null;
  previewUrl: string | null;
}

export interface PipelineObserverStatus {
  state: 'not_started' | 'pending' | 'finished' | 'incomplete';
  expiresAt: string | null;
}

export interface PipelineRunDetail extends PipelineRunSummary {
  observer: PipelineObserverStatus;
  task: {
    taskNumber: PipelineTaskNumber;
    maxScore: number;
    statement: string | null;
    content: TaskBlock[];
    referenceAnswer: string | null;
    referenceSolution: string | null;
    inputImage: { id: string; previewUrl: string } | null;
  };
  images: Attachment[];
  documents: SolutionDocument[];
  aiResult: ExpertCanonicalDocument | null;
  artifacts: PipelineArtifact[];
  imageArtifacts?: ExpertImageArtifactDto[];
  lastEventSeq: number;
}

export interface PipelineEvent {
  seq: number;
  type: string;
  phase: string;
  state: PipelineRunState;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface PipelineEventPage {
  items: PipelineEvent[];
  nextAfter: number;
  hasMore: boolean;
  observer: PipelineObserverStatus;
}

export interface PipelineManualInput {
  taskNumber: PipelineTaskNumber;
  taskImage: File;
  solutionImages: File[];
}

export type PipelineRunPage = Page<PipelineRunSummary>;
