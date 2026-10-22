'use client';

import { useEffect } from 'react';

import { MOCK_EXAM_DEMO, MOCK_EXAM_DEMO_COPY } from '@/config/mock-exam-demo';
import { isMockExamDemo, isMockExamDemoTask } from '@/lib/mock-exam-demo';
import { checkDemoPhoto } from '@/lib/api/mock-exam-demo';
import { useMockExamDemoStore } from '@/stores/mock-exam-demo-store';
import { useMockExamsStore } from '@/stores/mock-exams-store';

export function useMockExamDemo(examId: string, taskId?: string) {
  const review = useMockExamDemoStore();
  const enabled = isMockExamDemo(examId);
  const active = isMockExamDemoTask(examId, taskId);
  const attached = useMockExamsStore((state) =>
    Boolean(state.sessions[examId]?.attachments[MOCK_EXAM_DEMO.taskId]?.length),
  );
  const stage = review.stage === 'idle' && attached && !review.error ? 'ready' : review.stage;
  const { file, previewUrl, begin, setStage, fail, reset, releasePreview } = review;

  useEffect(() => {
    if (!previewUrl) return;
    return () => {
      URL.revokeObjectURL(previewUrl);
      releasePreview(previewUrl);
    };
  }, [previewUrl, releasePreview]);

  useEffect(() => {
    if (!enabled || !file) return;
    const controller = new AbortController();

    const check = async () => {
      try {
        await checkDemoPhoto(controller.signal);
        setStage('ready');
      } catch {
        if (!controller.signal.aborted) fail(MOCK_EXAM_DEMO_COPY.failed);
      }
    };
    void check();

    return () => controller.abort();
  }, [enabled, file, setStage, fail]);

  const attach = (files: File[]) => {
    const photo = files[0];
    if (!active || !photo) return;
    if (!photo.type.startsWith(MOCK_EXAM_DEMO.imageMimePrefix)) {
      fail(MOCK_EXAM_DEMO_COPY.invalidFile);
      return;
    }

    const store = useMockExamsStore.getState();
    const names = store.sessions[examId]?.attachments[MOCK_EXAM_DEMO.taskId] ?? [];
    names.forEach((name) => store.removeAttachment(examId, MOCK_EXAM_DEMO.taskId, name));
    store.addAttachments(examId, MOCK_EXAM_DEMO.taskId, [photo.name]);
    begin(photo, URL.createObjectURL(photo));
  };

  return {
    ...review,
    active,
    stage,
    busy: review.stage === 'photo' || review.stage === 'solution',
    visible: active && (review.completed || stage !== 'idle'),
    attach,
    reset,
  };
}
