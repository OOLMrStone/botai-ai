'use client';
import { createClientId } from '@/lib/client-id';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INTEGRATION, LEARNING_COPY as C } from '@/config/integration';
import { ApiError, requestErrorMessage, sleep } from '@/lib/api/client';
import {
  cancelSubmission,
  checkAttempt,
  createSubmission,
  deleteImage,
  deleteDocument,
  fetchAttempt,
  fetchSubmission,
  finalizeSubmission,
  patchAttempt,
  reportClientRejection,
  uploadImage,
  uploadDocument,
} from '@/lib/api/learning';
import type { Attempt, AttemptPatch, Submission } from '@/lib/api/learning-types';
import {
  solutionFileIsPdf,
  solutionFileRejection,
  solutionDocumentError,
  submissionDocumentsProcessing,
  submissionPagesReady,
} from '@/lib/solution-validation';
import { attemptDraft, ownsAttemptDraft } from '@/lib/attempt-drafts';
import { itemLocked, itemReadyToCheck } from '@/lib/attempt';
import { invalidateAttempts } from '@/lib/learning-resources';
import { useTasksStore } from '@/stores/tasks-store';
import { useHasFeature } from '@/hooks/use-plan';

export function useAttempt(id: string) {
  const canReviewPhoto = useHasFeature('aiReview');
  const session = useMemo(() => attemptDraft(id), [id]);
  const [attempt, setAttempt] = useState<Attempt | null>(session.snapshot);
  const [answers, setAnswers] = useState<Record<string, string>>(session.answers);
  const [busy, setBusy] = useState(Boolean(session.pending));
  const [editingBusy, setEditingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const active = useRef(true);
  const keys = useRef(new Map<string, string>());
  const savedDrawings = useTasksStore((state) => state.savedDrawings);
  const hasDraft = useCallback(() => {
    const state = useTasksStore.getState();
    return (
      Object.keys(session.answers).length > 0 ||
      Boolean(
        session.snapshot?.items.some(
          (item) => Object.hasOwn(state.savedDrawings, item.id) || state.editingDrawings[item.id],
        ),
      )
    );
  }, [session]);
  const accept = useCallback(
    (next: Attempt) => {
      if (!ownsAttemptDraft(id, session)) return next;
      if (session.snapshot && next.revision < session.snapshot.revision) return session.snapshot;
      const previous = session.snapshot;
      next = {
        ...next,
        items: next.items.map((item) => {
          const current = previous?.items.find((candidate) => candidate.id === item.id)?.submission;
          return current &&
            item.submission &&
            current.id === item.submission.id &&
            current.revision > item.submission.revision
            ? { ...item, submission: current }
            : item;
        }),
      };
      session.accept(next);
      if (active.current) {
        setAttempt(next);
        setAnswers({ ...session.answers });
        useTasksStore.getState().hydrate(next.items);
        invalidateAttempts();
      }
      return next;
    },
    [id, session],
  );
  const requestKey = (scope: string) => {
    if (!keys.current.has(scope)) keys.current.set(scope, createClientId());
    return keys.current.get(scope)!;
  };
  const refresh = useCallback(async () => {
    const generation = session.generation;
    const sequence = session.startFetch();
    let next: Attempt;
    try {
      next = await fetchAttempt(id);
    } catch (cause) {
      if (generation !== session.generation || sequence !== session.fetchSequence) {
        if (session.snapshot) return session.snapshot;
      }
      throw cause;
    }
    if (
      !ownsAttemptDraft(id, session) ||
      generation !== session.generation ||
      sequence !== session.fetchSequence
    )
      return session.snapshot ?? next;
    if (hasDraft() && session.snapshot && next.revision !== session.snapshot.revision)
      throw new ApiError(409, C.conflict);
    return accept(next);
  }, [accept, hasDraft, id, session]);
  const fail = useCallback(
    (cause: unknown) => {
      if (!active.current || !ownsAttemptDraft(id, session)) return;
      const collision = cause instanceof ApiError && cause.status === 409;
      setConflict(collision);
      setError(collision ? C.conflict : requestErrorMessage(cause, C.saveError));
    },
    [id, session],
  );
  useEffect(() => {
    active.current = true;
    void (async () => {
      await session.pending;
      if (active.current && ownsAttemptDraft(id, session)) await refresh();
    })()
      .catch(fail)
      .finally(() => {
        if (active.current) setBusy(false);
      });
    return () => {
      active.current = false;
    };
  }, [refresh, fail, id, session]);
  const run = async <T>(action: () => Promise<T>, lockEditing = true): Promise<T | null> => {
    if (session.pending || !ownsAttemptDraft(id, session)) return null;
    session.startMutation();
    setBusy(true);
    setEditingBusy(lockEditing);
    setError(null);
    const operation = (async () => {
      try {
        return await action();
      } catch (cause) {
        fail(cause);
        return null;
      } finally {
        session.finishMutation();
        if (active.current) {
          setBusy(false);
          setEditingBusy(false);
        }
      }
    })();
    session.track(operation);
    return operation;
  };
  const persist = async (currentIndex?: number) => {
    const previous = session.snapshot;
    if (!previous) throw new Error(C.loadError);
    if (conflict) throw new ApiError(409, C.conflict);
    const drawingState = useTasksStore.getState();
    const items: NonNullable<AttemptPatch['items']> = previous.items.flatMap((item) => {
      if (itemLocked(item) || drawingState.editingDrawings[item.id]) return [];
      const answer = session.answers[item.id];
      const drawing = drawingState.savedDrawings[item.id];
      if (answer === undefined && drawing === undefined) return [];
      if (
        (answer === undefined || answer === item.answer) &&
        (!drawing || JSON.stringify(drawing) === JSON.stringify(item.drawing))
      ) {
        session.acknowledge(item.id, answer);
        if (drawing) drawingState.acknowledge(item.id, drawing);
        return [];
      }
      return [{ id: item.id, answer, drawing }];
    });
    if (!items.length && (currentIndex === undefined || currentIndex === previous.currentIndex)) {
      setAnswers({ ...session.answers });
      return previous;
    }
    const next = await patchAttempt(id, { revision: previous.revision, currentIndex, items });
    if (!ownsAttemptDraft(id, session)) return next;
    for (const item of items) {
      session.acknowledge(item.id, item.answer);
      if (item.drawing) useTasksStore.getState().acknowledge(item.id, item.drawing);
    }
    setAnswers({ ...session.answers });
    return accept(next);
  };
  const save = () => run(() => persist(), false);
  const select = (index: number) => run(() => persist(index), false);
  const setAnswer = (itemId: string, answer: string) => {
    session.setAnswer(itemId, answer);
    setAnswers(session.answers);
  };
  useEffect(() => {
    if (
      conflict ||
      error ||
      busy ||
      (!Object.keys(answers).length && !Object.keys(savedDrawings).length)
    )
      return;
    const timeout = setTimeout(() => {
      void save();
    }, INTEGRATION.autosaveMs);
    return () => clearTimeout(timeout);
  });
  useEffect(() => {
    if (
      !attempt?.items.some((item) => ['queued', 'running'].includes(item.submission?.status ?? ''))
    )
      return;
    const timer = setInterval(() => {
      if (!session.pending) void refresh().catch(fail);
    }, INTEGRATION.pollMs);
    return () => clearInterval(timer);
  }, [attempt, refresh, fail, session]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        !Object.keys(session.answers).length &&
        !Object.keys(useTasksStore.getState().savedDrawings).length &&
        !session.pending
      )
        return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session]);
  const reload = () =>
    run(async () => {
      // Неудачный GET не должен удалять местные правки даже при явном отказе от них.
      const next = await fetchAttempt(id);
      if (!ownsAttemptDraft(id, session)) return next;
      session.clear();
      useTasksStore.getState().resetTaskProgress(next.items.map((item) => item.id));
      setConflict(false);
      return accept(next);
    });
  const retry = () => (attempt ? save() : run(refresh, false));
  const draftSubmission = async (itemId: string, retry = false): Promise<Submission> => {
    const state = await persist();
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(C.loadError);
    if (item.submission?.status === 'draft') return fetchSubmission(item.submission.id);
    if (item.submission && !retry) throw new Error(C.retryCheck);
    const previous = item.submission?.id;
    const submission = await createSubmission(
      id,
      itemId,
      item.answerRevision,
      requestKey(`intent:${itemId}:${item.answerRevision}:${previous ?? ''}`),
      previous,
    );
    await refresh();
    return submission;
  };
  const acceptSubmission = useCallback(
    (submission: Submission) => {
      const snapshot = session.snapshot;
      if (!snapshot || !ownsAttemptDraft(id, session)) return;
      const current = snapshot.items.find(
        (item) => item.id === submission.attemptItemId,
      )?.submission;
      if (current?.id !== submission.id || current.revision > submission.revision) return;
      accept({
        ...snapshot,
        items: snapshot.items.map((item) =>
          item.id === submission.attemptItemId ? { ...item, submission } : item,
        ),
      });
    },
    [accept, id, session],
  );
  useEffect(() => {
    const processing =
      attempt?.items.flatMap((item) =>
        item.submission && submissionDocumentsProcessing(item.submission)
          ? [item.submission.id]
          : [],
      ) ?? [];
    if (!processing.length) return;
    let stopped = false;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling || session.pending) return;
      polling = true;
      try {
        for (const submissionId of processing) {
          const submission = await fetchSubmission(submissionId);
          if (!stopped) {
            acceptSubmission(submission);
            if (!submissionDocumentsProcessing(submission)) await refresh();
          }
        }
      } catch (cause) {
        if (!stopped) fail(cause);
      } finally {
        polling = false;
      }
    }, INTEGRATION.pollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [attempt, acceptSubmission, fail, refresh, session]);
  const upload = (itemId: string, files: File[]) =>
    run(async () => {
      let submission = await draftSubmission(itemId);
      if (submissionDocumentsProcessing(submission)) throw new Error(C.pdfProcessing);
      if (submission.images.length + files.length > INTEGRATION.maxImages)
        throw new Error(C.image_count);
      for (const [index, file] of files.entries()) {
        const reason = await solutionFileRejection(file);
        if (reason) throw new Error(reason);
        if (solutionFileIsPdf(file)) {
          try {
            await uploadDocument(submission.id, file);
          } catch (cause) {
            await refresh();
            throw cause instanceof ApiError && cause.code?.startsWith('pdf_')
              ? new Error(solutionDocumentError(cause.code))
              : cause;
          }
        } else {
          const imageReason =
            submission.images.length >= INTEGRATION.maxImages ? 'image_count' : null;
          if (imageReason) {
            await reportClientRejection(submission.id, submission.revision, imageReason);
            throw new Error(C[imageReason]);
          }
          await uploadImage(submission.id, file);
        }
        submission = await fetchSubmission(submission.id);
        await refresh();
        acceptSubmission(submission);
        // Остальные выбранные файлы ждут атомарной конвертации и нового бюджета страниц.
        while (index < files.length - 1 && submissionDocumentsProcessing(submission)) {
          await sleep(INTEGRATION.pollMs);
          submission = await fetchSubmission(submission.id);
          acceptSubmission(submission);
        }
        if (index < files.length - 1) {
          const failed = submission.documents?.find((document) => document.state === 'failed');
          if (failed) throw new Error(solutionDocumentError(failed.errorCode));
        }
      }
      return session.snapshot;
    });
  const retrySubmission = (itemId: string) =>
    run(async () => {
      await draftSubmission(itemId, true);
      return refresh();
    });
  const removeImage = (submissionId: string, imageId: string) =>
    run(async () => {
      await deleteImage(submissionId, imageId);
      return refresh();
    });
  const removeDocument = (submissionId: string, documentId: string) =>
    run(async () => {
      await deleteDocument(submissionId, documentId);
      return refresh();
    });
  const cancel = (submissionId: string) =>
    run(async () => {
      await cancelSubmission(submissionId);
      return refresh();
    });
  const check = () =>
    run(async () => {
      let state = await persist();
      const readyItems = state.items.filter((item) => itemReadyToCheck(item, canReviewPhoto));
      if (!readyItems.length) return state;
      const issues: string[] = [];
      const itemIds: string[] = [];
      for (const item of readyItems) {
        if (item.task.responseType === 'short') {
          itemIds.push(item.id);
          continue;
        }
        if (!item.submission) continue;
        const submission = await fetchSubmission(item.submission.id);
        try {
          if (!submissionPagesReady(submission)) {
            const failed = submission.documents?.find((document) => document.state === 'failed');
            throw new Error(failed ? solutionDocumentError(failed.errorCode) : C.pdfProcessing);
          }
          await finalizeSubmission(submission.id, submission.revision);
          itemIds.push(item.id);
        } catch (cause) {
          issues.push(requestErrorMessage(cause, C.saveError));
        }
      }
      state = await refresh();
      if (issues.length) setError(issues.join(' · '));
      if (!itemIds.length) return state;
      const next = await checkAttempt(
        id,
        state.revision,
        requestKey(`check:${state.revision}:${itemIds.join(',')}`),
        itemIds,
      );
      invalidateAttempts();
      return accept(next);
    });
  return {
    attempt,
    canReviewPhoto,
    answers,
    busy,
    editingBusy,
    unsaved:
      Object.keys(answers).length > 0 ||
      Boolean(attempt?.items.some((item) => savedDrawings[item.id])),
    error,
    conflict,
    setAnswer,
    select,
    save,
    reload,
    retry,
    upload,
    removeImage,
    removeDocument,
    retrySubmission,
    cancel,
    check,
  };
}
