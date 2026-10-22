'use client';

import type { ComponentProps } from 'react';

import { ValidatedInput } from '@/components/ui/validated-input';

interface ValidatedFieldProps extends Omit<ComponentProps<'input'>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  validate: (value: string) => boolean;
  errorText: string;
}

// Поле с инлайн-валидацией: пусто - нейтрально, невалидно - красная рамка + текст,
// валидно - зелёная рамка + галочка. Единый способ провалидированного ввода.
export function ValidatedField({
  value,
  onChange,
  validate,
  errorText,
  className,
  ...props
}: ValidatedFieldProps) {
  const state = value.length === 0 ? 'neutral' : validate(value) ? 'success' : 'error';

  return (
    <>
      <ValidatedInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        validationState={state}
        className={className}
        {...props}
      />

      {state === 'error' ? <p className="text-destructive text-sm">{errorText}</p> : null}
    </>
  );
}
