'use client';
import { createClientId } from '@/lib/client-id';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncData } from '@/hooks/use-async-data';
import { examsResource, invalidateAttempts } from '@/lib/learning-resources';
import { createExamAttempt } from '@/lib/api/learning';
import { LEARNING_COPY as C, LEARNING_ROUTES, DATE_FORMAT } from '@/config/integration';
import type { MockExam, MockExamFilter, MockExamSort } from '@/config/mock-exams';
import type { MockExamResult, MockExamSession } from '@/stores/mock-exams-store';
export function useServerExams() {
  const state = useAsyncData(examsResource);
  const router = useRouter();
  const [sort, setSort] = useState<MockExamSort>('newest');
  const [filter, setFilter] = useState<MockExamFilter>('all');
  const [openingExamId, setOpeningExamId] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const opening = useRef(false);
  const active = useRef(true);
  const creationKeys = useRef(new Map<string, string>());
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const exams: MockExam[] = (state.data ?? []).map((exam) => ({
    id: exam.id,
    title: exam.title,
    date: exam.createdAt,
    dateLabel: DATE_FORMAT.format(new Date(exam.createdAt)),
    tasks: Array.from({ length: exam.totalTasks }, (_, index) => ({
      taskId: String(index),
      responseType: 'answer' as const,
    })),
    provenance: { kind: 'original' },
  }));
  const results: Record<string, MockExamResult> = Object.fromEntries(
    (state.data ?? [])
      .filter((exam) => exam.latestAttempt?.status === 'completed' && !exam.activeAttemptId)
      .map((exam) => [
        exam.id,
        {
          score: exam.latestAttempt!.summary.earnedPoints,
          completedAt: exam.latestAttempt!.completedAt ?? exam.latestAttempt!.createdAt,
        },
      ]),
  );
  const sessions: Record<string, MockExamSession> = Object.fromEntries(
    (state.data ?? [])
      .filter((exam) => exam.activeAttemptId)
      .map((exam) => [
        exam.id,
        { examId: exam.id, currentIndex: 0, answers: {}, attachments: {}, statuses: {} },
      ]),
  );
  const openExam = async (id: string, fresh = false) => {
    if (opening.current) return;
    const exam = state.data?.find((exam) => exam.id === id);
    if (!exam) return;
    opening.current = true;
    setOpeningExamId(id);
    setError(null);
    try {
      const attemptId = !fresh && (exam.activeAttemptId ?? exam.latestAttempt?.id);
      if (!attemptId && !creationKeys.current.has(id)) {
        creationKeys.current.set(id, createClientId());
      }
      const attempt = attemptId
        ? { id: attemptId }
        : await createExamAttempt(id, creationKeys.current.get(id)!);
      invalidateAttempts();
      if (!active.current) return;
      router.push(LEARNING_ROUTES.attempt(attempt.id));
    } catch (cause) {
      opening.current = false;
      if (!active.current) return;
      setError(cause instanceof Error ? cause.message : C.loadError);
      setOpeningExamId(undefined);
    }
  };
  return {
    ...state,
    exams,
    sort,
    filter,
    setSort,
    setFilter,
    results,
    sessions,
    error,
    openExam,
    openingExamId,
    pending: Boolean(openingExamId),
  };
}
