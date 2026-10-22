import type { Difficulty, DrawingStroke, TaskBlock, TaskSource } from '@/config/tasks';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export type GradingCapability = 'available' | 'unsupported' | 'unavailable';
export interface CatalogNumber {
  examNumber: number;
  part: 1 | 2;
  title: string;
  responseType: 'short' | 'photo';
  maxPoints: number;
  gradingCapability: GradingCapability;
  availableCount: number;
  topics: { id: string; title: string; availableCount: number; sourceUrl: string }[];
}
export interface Catalog {
  format: { id: string; version: number; title: string; totalTasks: number; maxPoints: number };
  numbers: CatalogNumber[];
}
export interface Task {
  id: string;
  taskVersionId: string;
  version: number;
  examNumber: number;
  part: 1 | 2;
  topicIds: string[];
  difficulty: Difficulty | null;
  isGrob: boolean;
  responseType: 'short' | 'photo';
  maxPoints: number;
  content: TaskBlock[];
  isFavourite: boolean;
  progressStatus: 'unstarted' | 'in-progress' | 'solved';
  gradingCapability: GradingCapability;
  isDemo: boolean;
  sourceYear: number | null;
  sources?: TaskSource[];
}
export interface GradeResult {
  isGraded: boolean;
  score: number | null;
  maxScore: number;
  feedback?: {
    ocr: string;
    analysis: {
      summary: string;
      checks: {
        domain: { isCorrect: boolean; reason: string } | null;
        transformations: { isCorrect: boolean; reason: string } | null;
        completeness: { isComplete: boolean; reason: string } | null;
      };
      studentAnswer: { text: string; isCorrect: boolean } | null;
      errors: {
        id: string;
        code: string;
        description: string;
        where: string;
        correctVersion: string;
        advice: string;
      }[];
      strengths: string[];
    };
    grading: { score: number; criterion: string; explanation: string };
  } | null;
  rejectionReason?: string;
  isDemo: boolean;
}
export type SubmissionStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'graded'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'unsupported';
export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  previewUrl: string;
  sourceDocumentId?: string | null;
  pageNumber?: number | null;
}
export interface SolutionDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  state: 'processing' | 'ready' | 'failed' | 'delete_pending' | 'deleted';
  revision: number;
  pageCount: number | null;
  pages: Omit<Attachment, 'status'>[];
  errorCode: string | null;
  downloadUrl: string | null;
}
export interface Submission {
  id: string;
  attemptId: string;
  attemptItemId: string;
  inputRevision: number;
  revision: number;
  status: SubmissionStatus;
  images: Attachment[];
  documents?: SolutionDocument[];
  createdAt: string;
  updatedAt: string;
  result?: GradeResult;
  errorCode?: string;
  retryable: boolean;
  isDemo: boolean;
}
export interface AttemptItem {
  id: string;
  task: Task;
  answer: string;
  drawing: DrawingStroke[];
  answerRevision: number;
  submission?: Submission;
  result?: GradeResult;
}
export interface Attempt {
  id: string;
  title?: string | null;
  kind: 'training' | 'mock-exam';
  templateId?: string;
  formatId: string;
  status: 'active' | 'checking' | 'completed';
  revision: number;
  currentIndex: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastExitedAt?: string | null;
  items: AttemptItem[];
  summary: {
    total: number;
    answered: number;
    graded: number;
    earnedPoints: number;
    maxPoints: number;
    pending: number;
    unsupported: number;
  };
}
export interface ExamTemplate {
  id: string;
  title: string;
  createdAt: string;
  totalTasks: number;
  maxPoints: number;
  isDemo: boolean;
  latestAttempt?: Pick<Attempt, 'id' | 'status' | 'createdAt' | 'completedAt' | 'summary'>;
  activeAttemptId?: string | null;
}
export interface TrainingSelection {
  examNumber: number;
  topicIds?: string[];
  count: number;
}
export interface TrainingRequest {
  formatId: string;
  selections: TrainingSelection[];
  difficulty?: Difficulty;
  difficultyPreference?: number;
  source?: 'catalog' | 'favorites';
  taskIds?: string[];
}
export interface AttemptPatch {
  revision: number;
  title?: string;
  currentIndex?: number;
  items?: { id: string; answer?: string; drawing?: DrawingStroke[] }[];
}
export interface Solution {
  referenceAnswer: string | null;
  referenceSolution: string | null;
  referenceAnswerContent?: TaskBlock[];
  referenceContent?: TaskBlock[];
}
