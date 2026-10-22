'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { PointerEvent as ReactPointerEvent } from 'react';

import { TASK_DRAWING } from '@/config/constants';
import type { DrawingPoint, DrawingStroke, DrawingTool } from '@/config/tasks';
import { createClientId } from '@/lib/client-id';
import { capturePointer } from '@/lib/pointer-capture';
import {
  drawingPointDistance,
  eraseDrawingAt,
  migrateDrawingToWorkspace,
} from '@/lib/task-drawing';
import { useTasksStore } from '@/stores/tasks-store';

const EMPTY_STROKES: DrawingStroke[] = [];

export function useTaskDrawing(
  taskId: string,
  ensureWritingSpace: (pointY: number) => void,
  scrollAtWritingEdge: (clientY: number) => void,
  panWorkspaceBy: (distance: number) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const activePointerId = useRef<number | null>(null);
  const activeStroke = useRef<DrawingStroke | null>(null);
  const gestureBaseline = useRef<DrawingStroke[] | null>(null);
  const touchPointers = useRef(new Map<number, number>());
  const multiTouchActive = useRef(false);
  const lastTouchCenterY = useRef<number | null>(null);
  const [tool, setTool] = useState<DrawingTool>('off');
  const strokes = useTasksStore((state) => state.drawings[taskId] ?? EMPTY_STROKES);
  const strokesRef = useRef(strokes);
  const setDrawing = useTasksStore((state) => state.setDrawing);
  const commitDrawing = useTasksStore((state) => state.commitDrawing);
  const finishDrawingGesture = useTasksStore((state) => state.finishDrawingGesture);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  const updateDrawing = useCallback(
    (next: DrawingStroke[]) => {
      strokesRef.current = next;
      setDrawing(taskId, next);
    },
    [setDrawing, taskId],
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const scale = canvas.width / width;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = TASK_DRAWING.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      const coordinateHeight =
        stroke.coordinateSpace === 'width'
          ? width
          : stroke.coordinateSpace === 'workspace'
            ? 1
            : height;
      if (stroke.points.length === 1) {
        const point = stroke.points[0];
        ctx.beginPath();
        ctx.arc(
          point.x * width,
          point.y * coordinateHeight,
          TASK_DRAWING.lineWidth / 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        continue;
      }
      if (stroke.points.length === 0) continue;
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * coordinateHeight;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, TASK_DRAWING.dprCap);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      if (strokesRef.current.some((stroke) => stroke.coordinateSpace !== 'width')) {
        updateDrawing(migrateDrawingToWorkspace(strokesRef.current, rect.height, rect.width));
        commitDrawing(taskId);
      }
      render();
    };
    resize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [render, updateDrawing, commitDrawing, taskId]);

  useEffect(render, [render, strokes]);

  const pointFor = (event: ReactPointerEvent<HTMLCanvasElement>): DrawingPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.width,
    };
  };

  const eraseAt = (point: DrawingPoint) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const currentStrokes = strokesRef.current;
    if (tool !== 'stroke-eraser' && tool !== 'point-eraser') return;
    updateDrawing(eraseDrawingAt(currentStrokes, point, width, tool));
  };

  const touchCenterY = () => {
    const points = [...touchPointers.current.values()];
    return points.reduce((sum, clientY) => sum + clientY, 0) / points.length;
  };

  const discardDrawing = () => {
    const baseline = gestureBaseline.current;
    if (baseline) {
      updateDrawing(baseline);
      finishDrawingGesture(taskId);
    }
    drawing.current = false;
    activePointerId.current = null;
    activeStroke.current = null;
    gestureBaseline.current = null;
  };

  const beginMultiTouch = () => {
    discardDrawing();
    multiTouchActive.current = true;
    lastTouchCenterY.current = touchCenterY();
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'off') return;
    if (event.pointerType === 'touch') {
      touchPointers.current.set(event.pointerId, event.clientY);
      capturePointer(event.currentTarget, event.pointerId);
      if (touchPointers.current.size >= TASK_DRAWING.panPointerCount) beginMultiTouch();
      if (multiTouchActive.current) return;
    }
    if (multiTouchActive.current) return;
    if (drawing.current) return;
    capturePointer(event.currentTarget, event.pointerId);
    drawing.current = true;
    activePointerId.current = event.pointerId;
    gestureBaseline.current = strokesRef.current;
    const point = pointFor(event);
    if (tool === 'pencil') {
      ensureWritingSpace(point.y * event.currentTarget.clientWidth);
      activeStroke.current = {
        id: createClientId(),
        points: [point],
        coordinateSpace: 'width',
      };
      updateDrawing([...strokesRef.current, activeStroke.current]);
    } else eraseAt(point);
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'touch' && touchPointers.current.has(event.pointerId)) {
      touchPointers.current.set(event.pointerId, event.clientY);
      if (multiTouchActive.current && touchPointers.current.size >= TASK_DRAWING.panPointerCount) {
        const centerY = touchCenterY();
        const previousCenterY = lastTouchCenterY.current ?? centerY;
        panWorkspaceBy(previousCenterY - centerY);
        lastTouchCenterY.current = centerY;
        return;
      }
    }
    if (activePointerId.current !== event.pointerId) return;
    if (!drawing.current) return;
    const point = pointFor(event);
    if (tool !== 'pencil') return eraseAt(point);
    const stroke = activeStroke.current;
    const previousPoint = stroke?.points[stroke.points.length - 1];
    const width = canvasRef.current?.clientWidth ?? 0;
    if (
      !stroke ||
      drawingPointDistance(previousPoint ?? point, point, width) < TASK_DRAWING.pointMinDistancePx
    )
      return;
    ensureWritingSpace(point.y * event.currentTarget.clientWidth);
    scrollAtWritingEdge(event.clientY);
    stroke.points.push(point);
    updateDrawing([
      ...strokesRef.current.filter((item) => item.id !== stroke.id),
      { ...stroke, points: [...stroke.points] },
    ]);
  };

  const releaseTouch = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType !== 'touch') return false;

    touchPointers.current.delete(event.pointerId);
    if (!multiTouchActive.current) return false;
    lastTouchCenterY.current =
      touchPointers.current.size >= TASK_DRAWING.panPointerCount
        ? touchCenterY()
        : (touchPointers.current.values().next().value ?? null);
    if (touchPointers.current.size === 0) {
      multiTouchActive.current = false;
      lastTouchCenterY.current = null;
    }
    return true;
  };

  // Потеря capture и системная отмена тоже завершают нанесённые изменения.
  // Откат нужен только при явном переходе к прокрутке двумя пальцами.
  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (releaseTouch(event)) return;
    if (activePointerId.current !== event.pointerId) return;
    if (!drawing.current) return;
    drawing.current = false;
    activePointerId.current = null;
    activeStroke.current = null;
    gestureBaseline.current = null;
    commitDrawing(taskId);
  };

  useEffect(
    () => () => {
      if (drawing.current) commitDrawing(taskId);
    },
    [commitDrawing, taskId],
  );

  const toggleTool = (nextTool: Exclude<DrawingTool, 'off'>) =>
    setTool((current) => (current === nextTool ? 'off' : nextTool));

  return { canvasRef, tool, toggleTool, start, move, end };
}
