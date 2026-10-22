import { Bookmark } from 'lucide-react';

import { TaskBlockRenderer } from '@/components/tasks/TaskBlockRenderer';
import { Button } from '@/components/ui/button';
import { DISABLED_ACTION_COPY } from '@/config/disabled-action';
import { layout } from '@/config/layout';
import {
  TASK_COPY,
  TRAINING_DRAWING_TOOLS,
  type TaskStatus,
  type TrainingTask,
  type TaskBlock,
} from '@/config/tasks';
import { useDrawingWorkspace } from '@/hooks/use-drawing-workspace';
import { useGestureSurfaceGuard } from '@/hooks/use-gesture-surface-guard';
import { useTaskFavorite } from '@/hooks/use-task-favorite';
import { useTaskDrawing } from '@/hooks/use-task-drawing';
import { cn } from '@/lib/utils';
import { preventGestureContextMenu } from '@/lib/gesture-surface';

import type { PointerEvent as ReactPointerEvent } from 'react';

interface TrainingTaskCardProps {
  task: Pick<TrainingTask, 'id' | 'content' | 'difficulty' | 'isGrob'>;
  drawingKey?: string;
  isFavourite?: boolean;
  solution?: TaskBlock[];
  canReveal?: boolean;
  revealBusy?: boolean;
  revealLabel?: string;
  locked?: boolean;
  allowScrollChain?: boolean;
  favoriteTaskId?: string;
  position: number;
  status: TaskStatus;
  solvedDate?: string;
  solutionRevealed: boolean;
  onToggleSolution: () => void;
}

export function TrainingTaskCard({
  task,
  drawingKey = task.id,
  isFavourite = false,
  solution = [],
  canReveal = false,
  revealBusy = false,
  revealLabel = TASK_COPY.training.solution,
  locked = false,
  allowScrollChain = false,
  favoriteTaskId,
  position,
  status,
  solvedDate,
  solutionRevealed,
  onToggleSolution,
}: TrainingTaskCardProps) {
  const favorite = useTaskFavorite(favoriteTaskId ?? task.id, isFavourite);
  const {
    viewportRef: workspaceViewportRef,
    contentRef: workspaceContentRef,
    height: workspaceHeight,
    ensureWritingSpace,
    scrollAtWritingEdge,
    panWorkspaceBy,
  } = useDrawingWorkspace(drawingKey);
  const drawing = useTaskDrawing(
    drawingKey,
    ensureWritingSpace,
    scrollAtWritingEdge,
    panWorkspaceBy,
  );
  const { canvasRef, tool, start, move, end } = drawing;
  const drawingToolActive = !locked && tool !== 'off';
  useGestureSurfaceGuard(canvasRef, {
    enabled: drawingToolActive,
    preventTouchDefaults: true,
  });
  const handleDrawingStart = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    start(event);
  };

  return (
    <article
      className={cn(layout.training.taskCard, drawingToolActive && layout.gestureSurface)}
      onContextMenu={drawingToolActive ? preventGestureContextMenu : undefined}
    >
      <div className={layout.training.cardHeader}>
        <div className={layout.training.titleGroup}>
          <h2 className={layout.training.cardTitle}>
            {TASK_COPY.training.task} {position}
            {task.isGrob ? (
              <span
                role="img"
                aria-label={TASK_COPY.difficulty[5]}
                className={layout.training.difficultyIcon}
              />
            ) : null}
          </h2>
          {solvedDate ? (
            <p className={layout.training.solvedMeta}>{TASK_COPY.training.solved(solvedDate)}</p>
          ) : null}
        </div>
        <div className={layout.training.actions}>
          <Button
            variant="ghost"
            size="icon-compact"
            className={layout.training.actionButton}
            aria-label={TASK_COPY.training.favorite}
            aria-pressed={favorite.favorite}
            disabled={favorite.saving}
            onClick={() => void favorite.toggle()}
          >
            <Bookmark
              className={cn(layout.training.actionIcon, favorite.favorite && 'fill-current')}
            />
          </Button>
          {TRAINING_DRAWING_TOOLS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              size="icon-compact"
              className={cn(
                layout.training.actionButton,
                tool === id && layout.training.actionButtonActive,
              )}
              aria-label={label}
              aria-pressed={tool === id}
              disabled={locked}
              disabledReason={!revealBusy ? DISABLED_ACTION_COPY.drawingLocked : undefined}
              onClick={() => drawing.toggleTool(id)}
            >
              {Icon ? (
                <Icon className={layout.training.actionIcon} />
              ) : (
                <span aria-hidden="true" className={layout.training.pointEraserIcon} />
              )}
            </Button>
          ))}
        </div>
      </div>
      <div
        ref={workspaceViewportRef}
        role="region"
        tabIndex={0}
        aria-label={TASK_COPY.training.workspace}
        className={cn(
          layout.training.drawingViewport,
          allowScrollChain && layout.training.drawingScrollChain,
          layout.focusRing,
          drawingToolActive && layout.gestureSurface,
        )}
      >
        <div
          className={layout.training.drawingDocument}
          style={workspaceHeight ? { height: workspaceHeight } : undefined}
        >
          <div ref={workspaceContentRef} className={layout.training.drawingContent}>
            <TaskBlockRenderer blocks={task.content} />
            {canReveal || (status !== 'unverified' && solution.length > 0) ? (
              <Button
                variant="ghost"
                className={layout.training.solutionButton}
                onClick={onToggleSolution}
                disabled={revealBusy}
              >
                {solutionRevealed ? TASK_COPY.training.hideSolution : revealLabel}
              </Button>
            ) : null}
            {solutionRevealed ? (
              <div className={layout.training.solution}>
                <TaskBlockRenderer blocks={solution} />
              </div>
            ) : null}
          </div>
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            onPointerDown={handleDrawingStart}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onContextMenu={preventGestureContextMenu}
            className={cn(
              layout.training.drawingCanvas,
              layout.gestureSurface,
              !drawingToolActive
                ? layout.training.drawingCanvasIdle
                : layout.training.drawingCanvasActive,
            )}
          />
        </div>
      </div>
    </article>
  );
}
