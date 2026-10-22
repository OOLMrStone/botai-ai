'use client';

import { useRef, useState } from 'react';
import { INTEGRATION, LEARNING_COPY } from '@/config/integration';
import { SCHOOL, SCHOOL_COPY } from '@/config/school';
import { ApiError } from '@/lib/api/client';
import { deleteDocument, deleteImage, uploadDocument, uploadImage } from '@/lib/api/learning';
import {
  attachSchoolFixture,
  cancelSchoolSubmission,
  createSchoolSubmission,
  fetchSchoolAssignment,
  fetchSchoolSubmission,
  finalizeSchoolSubmission,
} from '@/lib/api/school';
import type { SchoolAssignment, SchoolSubmission } from '@/lib/api/school-types';
import { schoolCanRetry, schoolSendDisabled } from '@/lib/school';
import { solutionFileIsPdf, solutionFileRejection } from '@/lib/solution-validation';
import { useSchoolStore } from '@/stores/school-store';
import { useSchoolError } from '@/hooks/use-school-error';

function uncertainRequest(cause: unknown) {
  return (
    cause instanceof TypeError ||
    cause instanceof SyntaxError ||
    cause instanceof DOMException ||
    (cause instanceof ApiError && cause.status >= 500)
  );
}

export function useSchoolSubmission(assignment: SchoolAssignment) {
  const busy = useSchoolStore((state) => state.busy);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const creation = useRef<{ afterId?: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const reportError = useSchoolError();

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current || useSchoolStore.getState().busy) return;
    inFlight.current = true;
    const store = useSchoolStore.getState();
    store.setBusy(true);
    store.setError(null);
    try {
      await action();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const fresh = await fetchSchoolAssignment(assignment.id).catch((recoveryError: unknown) => {
          reportError(recoveryError);
          return null;
        });
        if (fresh) store.setAssignment(fresh);
      }
      reportError(cause);
    } finally {
      inFlight.current = false;
      useSchoolStore.getState().setBusy(false);
    }
  };

  const create = async (retryOfId?: string, afterId = retryOfId) => {
    if (!creation.current || creation.current.afterId !== afterId)
      creation.current = { afterId, key: crypto.randomUUID() };
    const created = await createSchoolSubmission(assignment.id, creation.current.key, retryOfId);
    useSchoolStore.getState().acceptSubmission(created);
    return created;
  };

  const draft = async () => {
    const current = useSchoolStore.getState().assignment;
    if (current?.id !== assignment.id) throw new Error(SCHOOL_COPY.unavailable);
    if (current.fixtureAttachmentIncomplete) throw new Error(SCHOOL_COPY.fixtureIncomplete);
    if (!current.submission) return create();
    if (current.submission.status !== 'draft') throw new Error(SCHOOL_COPY.notDraft);
    return current.submission;
  };

  const refresh = async (id: string) => {
    const latest = await fetchSchoolSubmission(id);
    useSchoolStore.getState().acceptSubmission(latest);
    return latest;
  };

  const recover = async (id: string) => {
    try {
      return await refresh(id);
    } catch (cause) {
      reportError(cause);
      return null;
    }
  };

  const upload = (files: File[]) =>
    run(async () => {
      if (!files.length) return;
      setPendingFiles(files);
      for (const file of files) {
        const reason = await solutionFileRejection(file);
        if (reason) throw new Error(reason);
      }
      let current = await draft();
      if (current.images.length + files.length > INTEGRATION.maxImages)
        throw new Error(LEARNING_COPY.image_count);

      for (const [index, file] of files.entries()) {
        try {
          if (solutionFileIsPdf(file)) await uploadDocument(current.id, file);
          else await uploadImage(current.id, file);
        } catch (cause) {
          if (uncertainRequest(cause)) {
            // У загрузки нет idempotency key: неизвестный исход нельзя повторять незаметно.
            setPendingFiles(files.slice(index + 1));
            await recover(current.id);
            throw new Error(SCHOOL_COPY.uploadUncertain);
          }
          throw cause;
        }
        setPendingFiles(files.slice(index + 1));
        current = await refresh(current.id);
      }
    });

  const remove = (id: string, document: boolean) =>
    run(async () => {
      const current = await draft();
      if (document) await deleteDocument(current.id, id);
      else await deleteImage(current.id, id);
      await refresh(current.id);
    });

  const send = () =>
    run(async () => {
      const current = await draft();
      const disabled = schoolSendDisabled(current, false);
      if (pendingFiles.length) throw new Error(SCHOOL_COPY.filesRemaining);
      if (disabled) throw new Error(disabled);
      let accepted: SchoolSubmission;
      try {
        accepted = await finalizeSchoolSubmission(current.id, current.revision);
      } catch (cause) {
        const rejectedBeforeDispatch =
          cause instanceof ApiError &&
          cause.status === 503 &&
          SCHOOL.preDispatchErrors.some((code) => code === cause.code);
        if (rejectedBeforeDispatch || !uncertainRequest(cause)) throw cause;
        const recovered = await recover(current.id);
        if (recovered && recovered.status !== 'draft') return;
        throw new Error(SCHOOL_COPY.sendUncertain);
      }
      useSchoolStore.getState().acceptSubmission(accepted);
    });

  const attachFixture = () =>
    run(async () => {
      if (!assignment.fixtureAvailable) throw new Error(SCHOOL_COPY.unavailable);
      const current = await draft();
      try {
        useSchoolStore
          .getState()
          .acceptSubmission(await attachSchoolFixture(assignment.id, current.id));
      } catch (cause) {
        const fresh = await fetchSchoolAssignment(assignment.id).catch(() => null);
        if (fresh) useSchoolStore.getState().setAssignment(fresh);
        if (!uncertainRequest(cause)) throw cause;
        throw new Error(SCHOOL_COPY.fixtureUncertain);
      }
    });

  const restartFixture = () =>
    run(async () => {
      const current = useSchoolStore.getState().assignment;
      if (
        current?.id !== assignment.id ||
        !current.fixtureAttachmentIncomplete ||
        current.submission?.status !== 'draft'
      )
        throw new Error(SCHOOL_COPY.notDraft);
      let cancelled: SchoolSubmission;
      try {
        cancelled = await cancelSchoolSubmission(current.submission.id);
      } catch (cause) {
        const fresh = await fetchSchoolAssignment(assignment.id).catch(() => null);
        if (fresh) useSchoolStore.getState().setAssignment(fresh);
        throw cause;
      }
      useSchoolStore.getState().acceptSubmission(cancelled);
      await create(cancelled.id);
      setPendingFiles([]);
    });

  const retry = () =>
    run(async () => {
      const current = useSchoolStore.getState().assignment?.submission ?? null;
      if (
        !current ||
        (!schoolCanRetry(current) && !useSchoolStore.getState().assignment?.canResubmit)
      )
        throw new Error(SCHOOL_COPY.notDraft);
      await create(schoolCanRetry(current) ? current.id : undefined, current.id);
      setPendingFiles([]);
    });

  return {
    busy,
    pendingFiles,
    clearPendingFiles: () => setPendingFiles([]),
    upload,
    retryUpload: () => upload(pendingFiles),
    removeImage: (id: string) => remove(id, false),
    removeDocument: (id: string) => remove(id, true),
    send,
    retry,
    attachFixture,
    restartFixture,
    sendDisabled: assignment.fixtureAttachmentIncomplete
      ? SCHOOL_COPY.fixtureIncomplete
      : pendingFiles.length
        ? SCHOOL_COPY.filesRemaining
        : schoolSendDisabled(assignment.submission, busy),
  };
}

export type SchoolSubmissionActions = ReturnType<typeof useSchoolSubmission>;
