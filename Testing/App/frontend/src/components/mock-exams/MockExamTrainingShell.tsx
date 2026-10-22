'use client';
import { TrainingShell } from '@/components/tasks/TrainingShell';
export function MockExamTrainingShell({ examId }: { examId: string }) {
  return <TrainingShell key={examId} attemptId={examId} />;
}
