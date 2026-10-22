'use client';

import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { layout } from '@/config/layout';
import { COPY } from '@/config/onboarding-steps';

// Единственный способ показать пользователю ошибку запроса: плашка с текстом и,
// если повтор имеет смысл, кнопкой «Повторить». Экраны не рисуют ошибки сами.
export function ErrorNote({
  message,
  onRetry,
  retryLabel = COPY.errors.retry,
  title,
  retrySize = 'default',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  title?: string;
  retrySize?: 'default' | 'multiline';
}) {
  return (
    <div role="alert" className={title ? layout.errorNote.screen : layout.errorNote.root}>
      <TriangleAlert
        className={title ? layout.errorNote.screenIcon : layout.errorNote.icon}
        aria-hidden="true"
      />
      {title ? (
        <ScreenHeading variant="app" title={title} subtitle={message} />
      ) : (
        <p className={layout.errorNote.message}>{message}</p>
      )}
      {onRetry ? (
        <Button
          size={retrySize}
          variant="outline"
          onClick={onRetry}
          className={title ? undefined : layout.errorNote.retry}
        >
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
