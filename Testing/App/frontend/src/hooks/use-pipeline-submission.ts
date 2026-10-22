import { useEffect, useRef, useState } from 'react';
import { PIPELINE_CONSOLE as CONFIG, PIPELINE_COPY as COPY } from '@/config/pipeline-console';
import { ApiError } from '@/lib/api/client';
import { submitPipelineRun, pipelineRequestError } from '@/lib/api/pipeline-console';
import type { PipelineRunDetail, PipelineTaskNumber } from '@/lib/api/pipeline-console-types';
import { pipelineSubmissionUncertain, validatePipelineFile } from '@/lib/pipeline-console';

export function usePipelineSubmission(onCreated: (run: PipelineRunDetail) => void) {
  const [open, setOpen] = useState(false);
  const [taskNumber, setTaskNumber] = useState<PipelineTaskNumber>(CONFIG.initialTaskNumber);
  const [taskImage, setTaskImage] = useState<File | null>(null);
  const [solutionImages, setSolutionImages] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const lifecycle = useRef(0);

  useEffect(() => {
    lifecycle.current += 1;
    return () => {
      lifecycle.current += 1;
    };
  }, []);

  function change() {
    idempotencyKey.current = null;
    setError(null);
    setUncertain(false);
  }
  function selectNumber(value: PipelineTaskNumber) {
    if (busy) return;
    change();
    setTaskNumber(value);
  }
  function addTask(files: File[]) {
    if (busy || !files.length) return;
    const invalid = validatePipelineFile(files[0]);
    if (invalid) {
      setError(invalid);
      return;
    }
    change();
    setTaskImage(files[0]);
  }
  function addSolutions(files: File[]) {
    if (busy || !files.length) return;
    if (files.length + solutionImages.length > CONFIG.maxSolutionImages) {
      setError(COPY.errors.tooMany);
      return;
    }
    const invalid = files.map(validatePipelineFile).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    change();
    setSolutionImages((current) => [...current, ...files]);
  }
  function removeSolution(index: number) {
    if (busy) return;
    change();
    setSolutionImages((current) => current.filter((_, item) => item !== index));
  }
  function removeTask() {
    if (busy) return;
    change();
    setTaskImage(null);
  }
  function close(value: boolean) {
    if (!busy) setOpen(value);
  }

  async function submit() {
    if (submitting.current) return;
    if (!taskImage) {
      setError(COPY.errors.taskImage);
      return;
    }
    if (!solutionImages.length) {
      setError(COPY.errors.solutions);
      return;
    }
    submitting.current = true;
    const generation = lifecycle.current;
    setBusy(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const run = await submitPipelineRun(
        { taskNumber, taskImage, solutionImages },
        idempotencyKey.current,
      );
      if (generation !== lifecycle.current) return;
      onCreated(run);
      setOpen(false);
      setTaskImage(null);
      setSolutionImages([]);
      change();
    } catch (cause) {
      if (generation !== lifecycle.current) return;
      // Тот же ключ сохраняется после сетевой неопределённости, чтобы повтор не создал вторую проверку.
      const ambiguous = pipelineSubmissionUncertain(
        cause instanceof ApiError ? cause.status : undefined,
        cause instanceof ApiError ? cause.code : undefined,
      );
      setUncertain(ambiguous);
      setError(pipelineRequestError(cause, COPY.errors.submit));
    } finally {
      submitting.current = false;
      if (generation === lifecycle.current) setBusy(false);
    }
  }

  return {
    open,
    close,
    taskNumber,
    taskImage,
    solutionImages,
    error,
    busy,
    uncertain,
    selectNumber,
    addTask,
    addSolutions,
    removeTask,
    removeSolution,
    submit,
  };
}

export type PipelineSubmission = ReturnType<typeof usePipelineSubmission>;
