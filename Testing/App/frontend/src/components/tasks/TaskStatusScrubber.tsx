'use client';

import { CheckCheck } from 'lucide-react';

import { layout } from '@/config/layout';
import { TASK_COPY, type TaskStatus } from '@/config/tasks';
import { useTaskScrubber } from '@/hooks/use-task-scrubber';
import { preventGestureContextMenu } from '@/lib/gesture-surface';
import { cn } from '@/lib/utils';

interface Props {
  taskIds: string[];
  answeredTaskIds: string[];
  statuses: Record<string, TaskStatus>;
  currentIndex: number;
  reviewActive: boolean;
  onSelect: (index: number) => void;
  onReview?: () => void;
  label?: string;
  valueLabels?: readonly string[];
  statusStyles?: Partial<Record<TaskStatus, { segment?: string; lens?: string }>>;
  selection?: 'indicator' | 'outline';
}

export function TaskStatusScrubber({
  taskIds,
  answeredTaskIds,
  statuses,
  currentIndex,
  reviewActive,
  onSelect,
  onReview,
  label = TASK_COPY.training.navigation,
  valueLabels,
  statusStyles,
  selection = 'indicator',
}: Props) {
  const {
    scrubberRef,
    precise,
    previewIndex,
    valueIndex,
    lensIndices,
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
  } = useTaskScrubber({ taskCount: taskIds.length, currentIndex, onSelect });

  return (
    <div className={layout.training.scrubberFrame}>
      <div
        ref={scrubberRef}
        role="slider"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={taskIds.length}
        aria-valuenow={valueIndex + 1}
        aria-valuetext={valueLabels?.[valueIndex]}
        tabIndex={0}
        className={cn(layout.training.scrubberTrack, layout.focusRing, layout.gestureSurface)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onContextMenu={preventGestureContextMenu}
      >
        {taskIds.map((id, index) => {
          const status = statuses[id] ?? 'unverified';
          const answered = answeredTaskIds.includes(id);
          return (
            <span
              key={id}
              className={cn(
                layout.training.scrubberSegment,
                status === 'correct' && layout.training.segmentCorrect,
                status === 'incorrect' && layout.training.segmentIncorrect,
                status === 'partial' && layout.training.segmentAnswered,
                status === 'unverified' && answered && layout.training.segmentAnswered,
                status === 'unverified' && !answered && layout.training.segmentEmpty,
                !reviewActive && currentIndex === index && layout.training.segmentCurrent,
                !reviewActive &&
                  currentIndex === index &&
                  selection === 'outline' &&
                  layout.training.segmentCurrentOutline,
                statusStyles?.[status]?.segment,
              )}
            >
              {!reviewActive && currentIndex === index && selection === 'indicator' ? (
                <span className={layout.training.scrubberIndicator} />
              ) : null}
            </span>
          );
        })}
        {precise ? (
          <div className={layout.training.scrubberLens}>
            {lensIndices.map((index) => {
              const selected = index === previewIndex;
              const taskId = taskIds[index];
              const status = statuses[taskId] ?? 'unverified';
              const answered = answeredTaskIds.includes(taskId);
              const visualStatus =
                status === 'unverified' ? (answered ? 'answered' : 'empty') : status;

              return (
                <span
                  key={taskId}
                  data-selected={selected}
                  data-status={visualStatus}
                  className={cn(
                    layout.training.scrubberLensSegment,
                    layout.training.lensItem,
                    selected && layout.training.lensItemActive,
                    statusStyles?.[status]?.lens,
                  )}
                >
                  {index + 1}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
      {onReview ? (
        <button
          type="button"
          aria-label={TASK_COPY.review.title}
          className={cn(
            layout.training.reviewIndicator,
            layout.focusRing,
            reviewActive ? layout.training.reviewActive : layout.training.reviewInactive,
          )}
          onClick={onReview}
        >
          <CheckCheck className={layout.training.reviewIcon} />
        </button>
      ) : null}
    </div>
  );
}
