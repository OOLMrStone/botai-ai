'use client';

import { useEffect } from 'react';

import { MOCK_EXAM_DEMO } from '@/config/mock-exam-demo';
import { IS_MOCK_API } from '@/config/env';
import { useMockExamDemoStore } from '@/stores/mock-exam-demo-store';
import { useMockExamsStore } from '@/stores/mock-exams-store';
import { useTasksStore } from '@/stores/tasks-store';

export function useMockExamDemoControls() {
  const reset = async () => {
    if (!IS_MOCK_API) return;

    const { examId } = MOCK_EXAM_DEMO;
    const tasks = useTasksStore.getState();
    const taskIds = Object.keys({
      ...tasks.drawings,
      ...tasks.savedDrawings,
      ...tasks.history,
      ...tasks.solvedAt,
    }).filter((taskId) => taskId.startsWith(`${examId}:`));

    useMockExamDemoStore.getState().reset();
    tasks.resetTaskProgress(taskIds);
    useMockExamsStore.getState().resetExam(examId);
  };

  useEffect(() => {
    if (!IS_MOCK_API) return;

    if (useMockExamDemoStore.getState().resetRevision < MOCK_EXAM_DEMO.resetRevision) {
      void reset();
    }
  }, []);

  const prepare = () => {
    if (!IS_MOCK_API) return;

    const store = useMockExamsStore.getState();
    store.start(MOCK_EXAM_DEMO.examId);
    store.setCurrentIndex(MOCK_EXAM_DEMO.examId, MOCK_EXAM_DEMO.taskNumber - 1);
  };

  return { reset, prepare };
}
