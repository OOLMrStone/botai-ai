'use client';

import { useParams } from 'next/navigation';

import { MockExamTrainingShell } from '@/components/mock-exams/MockExamTrainingShell';
import { SessionStatus } from '@/components/common/SessionStatus';
import { useRequireAuth } from '@/hooks/use-require-auth';

export default function MockExamTrainingPage() {
  const { examId } = useParams<{ examId: string }>();
  const auth = useRequireAuth();

  if (auth.status !== 'authenticated') return <SessionStatus {...auth} />;

  return <MockExamTrainingShell examId={examId} />;
}
