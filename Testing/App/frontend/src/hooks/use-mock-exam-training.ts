'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import {
  MOCK_EXAM_DEMO,
  MOCK_EXAM_DEMO_CONTENT,
  MOCK_EXAM_DEMO_COPY,
} from '@/config/mock-exam-demo';
import { useMockExamDemo } from '@/hooks/use-mock-exam-demo';
import { useMockExamDemoControls } from '@/hooks/use-mock-exam-demo-controls';
import { MOCK_EXAMS, MOCK_EXAM_CATALOG_PATH } from '@/config/mock-exams';
import { useMockExamCheck } from '@/hooks/use-mock-exam-check';
import { checkDemoSolution } from '@/lib/api/mock-exam-demo';
import type { TaskStatus, TrainingTask } from '@/config/tasks';
import { useKeyboardViewport } from '@/hooks/use-keyboard-viewport';
import { useTaskKeyboardNavigation } from '@/hooks/use-task-keyboard-navigation';
import { isMockExamDemo, isMockExamDemoTask } from '@/lib/mock-exam-demo';
import { mockExamScore } from '@/lib/mock-exams';
import { isValidShortAnswer } from '@/lib/validation';
import { isTrainingAnswerCorrect } from '@/lib/task-training';
import { useMockExamsStore } from '@/stores/mock-exams-store';

export function useMockExamTraining(examId: string, taskBank: TrainingTask[]) {
  useMockExamDemoControls();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTask = searchParams.get(MOCK_EXAM_DEMO.taskQueryKey);
  const exam = MOCK_EXAMS.find((candidate) => candidate.id === examId);
  const session = useMockExamsStore((state) => state.sessions[examId]);
  const result = useMockExamsStore((state) => state.results[examId]);
  const start = useMockExamsStore((state) => state.start);
  const setCurrentIndex = useMockExamsStore((state) => state.setCurrentIndex);
  const setAnswer = useMockExamsStore((state) => state.setAnswer);
  const checkAnswer = useMockExamsStore((state) => state.checkAnswer);
  const addAttachments = useMockExamsStore((state) => state.addAttachments);
  const removeAttachment = useMockExamsStore((state) => state.removeAttachment);
  const check = useMockExamsStore((state) => state.check);
  useKeyboardViewport();

  useEffect(() => {
    if (!exam) return;
    start(examId);
    if (isMockExamDemo(examId) && requestedTask === String(MOCK_EXAM_DEMO.taskNumber)) {
      setCurrentIndex(examId, MOCK_EXAM_DEMO.taskNumber - 1);
    }
  }, [exam, examId, start, requestedTask, setCurrentIndex]);

  const taskMap = new Map(taskBank.map((task) => [task.id, task]));
  const tasks = exam?.tasks.flatMap((item, index) => {
    const task = taskMap.get(item.taskId);
    return task
      ? [
          {
            ...task,
            content: isMockExamDemoTask(examId, item.taskId)
              ? MOCK_EXAM_DEMO_CONTENT
              : task.content,
            id: `${examId}:${task.id}`,
            examPart: item.responseType === 'attachment' ? (2 as const) : (1 as const),
            examNumber: index + 1,
          },
        ]
      : [];
  });
  const currentIndex = session?.currentIndex ?? 0;
  const task = tasks?.[currentIndex];
  const taskRef = exam?.tasks[currentIndex];
  const demo = useMockExamDemo(examId, taskRef?.taskId);
  const examCheck = useMockExamCheck(examId, demo.cancelChecking);
  const reviewIndex = exam?.tasks.length ?? 0;
  const selectTask = (index: number) => setCurrentIndex(examId, index);
  useTaskKeyboardNavigation({
    currentIndex,
    lastIndex: reviewIndex,
    enabled: Boolean(session) && reviewIndex > 0 && !examCheck.checking && !demo.busy,
    onSelect: selectTask,
  });
  const review = currentIndex === reviewIndex;
  const answeredTaskIds = (exam?.tasks ?? [])
    .filter((item) =>
      item.responseType === 'attachment'
        ? Boolean(session?.attachments[item.taskId]?.length)
        : isValidShortAnswer(session?.answers[item.taskId]),
    )
    .map((item) => item.taskId);

  const statuses =
    exam?.tasks.reduce<Record<string, TaskStatus>>((current, item) => {
      const waiting =
        examCheck.checking &&
        item.responseType === 'attachment' &&
        Boolean(session?.attachments[item.taskId]?.length);
      current[item.taskId] = waiting
        ? 'unverified'
        : isMockExamDemoTask(examId, item.taskId) && demo.completed
          ? 'correct'
          : (session?.statuses[item.taskId] ?? 'unverified');
      return current;
    }, {}) ?? {};

  const checkAnswers = async () => {
    if (!exam || !session || !tasks || demo.stage === 'photo') return;
    const hasAttachments = exam.tasks.some(
      (item) => item.responseType === 'attachment' && session.attachments[item.taskId]?.length,
    );
    const demoAttached =
      isMockExamDemo(examId) && Boolean(session.attachments[MOCK_EXAM_DEMO.taskId]?.length);

    try {
      await examCheck.run(async (signal) => {
        for (const item of exam.tasks) {
          const currentTask = taskMap.get(item.taskId);
          if (item.responseType === 'answer' && currentTask) checkAnswer(examId, currentTask);
        }
        setCurrentIndex(examId, 0);

        if (hasAttachments) {
          if (demoAttached) {
            demo.startChecking();
          }
          await checkDemoSolution(signal);
          signal.throwIfAborted();
        }
        if (demoAttached) demo.finish();
        const statuses = exam.tasks.reduce<Record<string, 'correct' | 'incorrect'>>(
          (next, item) => {
            if (item.responseType === 'attachment') {
              next[item.taskId] = isMockExamDemoTask(examId, item.taskId)
                ? demoAttached
                  ? 'correct'
                  : 'incorrect'
                : session.attachments[item.taskId]?.length
                  ? 'correct'
                  : 'incorrect';
              return next;
            }
            const currentTask = taskMap.get(item.taskId);
            const answer = session.answers[item.taskId];
            next[item.taskId] =
              currentTask && isTrainingAnswerCorrect(currentTask, answer) ? 'correct' : 'incorrect';
            return next;
          },
          {},
        );
        const correct = Object.values(statuses).filter((status) => status === 'correct').length;
        check(examId, statuses, mockExamScore(correct, exam.tasks.length));
        if (demoAttached) setCurrentIndex(examId, MOCK_EXAM_DEMO.taskNumber - 1);
      });
    } catch {
      demo.fail(MOCK_EXAM_DEMO_COPY.failed);
    }
  };

  return {
    exam,
    demo,
    statuses,
    checking: examCheck.checking,
    checkDisabled: examCheck.checking || demo.stage === 'photo',
    session,
    result,
    tasks,
    task,
    taskRef,
    review,
    reviewIndex,
    answeredTaskIds,
    currentIndex,
    setCurrentIndex: selectTask,
    setAnswer: (taskId: string, answer: string) => setAnswer(examId, taskId, answer),
    addAttachments: (taskId: string, files: File[]) => {
      if (demo.active) demo.attach(files);
      else
        addAttachments(
          examId,
          taskId,
          files.map((file) => file.name),
        );
    },
    removeAttachment: (taskId: string, name: string) => {
      if (demo.active) demo.reset();
      removeAttachment(examId, taskId, name);
    },
    exit: () => router.push(MOCK_EXAM_CATALOG_PATH),
    checkAnswers,
  };
}
