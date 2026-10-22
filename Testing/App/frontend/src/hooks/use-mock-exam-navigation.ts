'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { mockExamPath, type MockExam } from '@/config/mock-exams';

export function useMockExamNavigation(exams: MockExam[]) {
  const router = useRouter();
  const [openingExamId, setOpeningExamId] = useState<string>();
  const [pending, startTransition] = useTransition();
  const opening = useRef(false);

  useEffect(() => {
    for (const exam of exams) router.prefetch(mockExamPath(exam.id));
  }, [exams, router]);

  useEffect(() => {
    if (!pending) opening.current = false;
  }, [pending]);

  const openExam = (examId: string) => {
    if (opening.current) return;

    opening.current = true;
    setOpeningExamId(examId);
    startTransition(() => router.push(mockExamPath(examId)));
  };

  return { openExam, openingExamId: pending ? openingExamId : undefined, pending };
}
