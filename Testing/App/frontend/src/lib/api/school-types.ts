import type { B2B_TASK_NUMBERS } from '@/config/b2b';
import type { TaskBlock } from '@/config/tasks';
import type { ExpertCanonicalDocument, ExpertImageArtifactDto } from '@/lib/api/expert-types';
import type { Attachment, SolutionDocument } from '@/lib/api/learning-types';

export type SchoolTaskNumber = (typeof B2B_TASK_NUMBERS)[number];
export type SchoolStatus =
  | 'not_started'
  | 'draft'
  | 'queued'
  | 'running'
  | 'awaiting_expert'
  | 'reviewing'
  | 'returned'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface SchoolIdentity {
  id: string;
  email: string;
  displayName: string | null;
  schools: { id: string; name: string }[];
  taskNumbers: SchoolTaskNumber[];
}

export interface SchoolAssignmentSummary {
  id: string;
  school: { id: string; name: string };
  title: string;
  taskNumber: SchoolTaskNumber;
  maxScore: number;
  assignedAt: string;
  dueAt: string | null;
  status: SchoolStatus;
  submissionId: string | null;
  updatedAt: string;
}

export interface SchoolSubmission {
  id: string;
  assignmentId: string;
  origin: 'school';
  revision: number;
  status: Exclude<SchoolStatus, 'not_started'>;
  images: Attachment[];
  documents: SolutionDocument[];
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  retryable: boolean;
  expertReview: { status: 'queued' | 'draft' | 'sent'; sentAt: string | null } | null;
  result: ExpertCanonicalDocument | null;
  imageArtifacts: ExpertImageArtifactDto[];
}

export interface SchoolAssignment extends SchoolAssignmentSummary {
  task: {
    taskNumber: SchoolTaskNumber;
    maxScore: number;
    statement: string;
    content: TaskBlock[];
  };
  submission: SchoolSubmission | null;
  fixtureAvailable?: boolean;
  fixtureAttachmentIncomplete?: boolean;
  canResubmit?: boolean;
  history?: SchoolSubmission[];
}
