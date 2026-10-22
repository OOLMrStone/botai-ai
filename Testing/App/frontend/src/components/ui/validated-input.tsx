'use client';

import type { ComponentProps, ReactNode } from 'react';

import { Check } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { layout } from '@/config/layout';
import { cn } from '@/lib/utils';

export type InputValidationState = 'neutral' | 'error' | 'success';

interface ValidatedInputProps extends ComponentProps<'input'> {
  validationState: InputValidationState;
  trailingAction?: ReactNode;
}

export function ValidatedInput({
  validationState,
  trailingAction,
  className,
  ...props
}: ValidatedInputProps) {
  return (
    <div className={layout.validatedInput.frame}>
      <Input
        aria-invalid={validationState === 'error'}
        className={cn(
          validationState === 'success' && layout.validatedInput.success,
          className,
          trailingAction && layout.validatedInput.withAction,
        )}
        {...props}
      />
      {trailingAction ??
        (validationState === 'success' ? (
          <Check aria-hidden="true" className={layout.validatedInput.successIcon} />
        ) : null)}
    </div>
  );
}
