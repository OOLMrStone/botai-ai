'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useMockExamsStore } from '@/stores/mock-exams-store';

export function useMockExamCheck(examId: string, onCancel: () => void) {
  const [checking, setChecking] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const cancel = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    controllerRef.current = null;
    controller.abort();
    setChecking(false);
    onCancelRef.current();
  }, []);

  useEffect(() => {
    const unsubscribe = useMockExamsStore.subscribe((state, previous) => {
      const session = state.sessions[examId];
      const previousSession = previous.sessions[examId];
      if (
        session?.answers !== previousSession?.answers ||
        session?.attachments !== previousSession?.attachments
      ) {
        cancel();
      }
    });

    return () => {
      unsubscribe();
      cancel();
    };
  }, [examId, cancel]);

  const run = useCallback(async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (controllerRef.current) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setChecking(true);

    try {
      await operation(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setChecking(false);
      }
    }
  }, []);

  return { checking, run };
}
