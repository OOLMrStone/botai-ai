'use client';

import { useRef, useState, type PointerEvent } from 'react';

import { SHORT_ANSWER_COPY } from '@/config/short-answer';
import { isShortAnswerDraft, isValidShortAnswer } from '@/lib/validation';

interface AnswerInputOptions {
  answerKey: string;
  value: string;
  disabled: boolean;
  readOnly: boolean;
  onValueChange: (value: string) => void;
}

export function useAnswerInput({
  answerKey,
  value,
  disabled,
  readOnly,
  onValueChange,
}: AnswerInputOptions) {
  const [errorFor, setErrorFor] = useState<{
    answerKey: string;
    value: string;
    message: string;
  } | null>(null);
  const storedInvalid = !isShortAnswerDraft(value);
  const error = storedInvalid
    ? SHORT_ANSWER_COPY.invalid
    : errorFor?.answerKey === answerKey && errorFor.value === value
      ? errorFor.message
      : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const canClear = value.length > 0 && !disabled && !readOnly;
  const errorHint = error
    ? error === SHORT_ANSWER_COPY.incomplete
      ? SHORT_ANSWER_COPY.incompleteHint
      : SHORT_ANSWER_COPY.invalidHint
    : undefined;
  const showInlineHint = Boolean(errorHint && value);

  const change = (nextValue: string) => {
    if (disabled || readOnly) return;
    if (!isShortAnswerDraft(nextValue)) {
      setErrorFor({ answerKey, value, message: SHORT_ANSWER_COPY.invalid });
      return;
    }

    setErrorFor(null);
    onValueChange(nextValue);
  };

  const blur = () => {
    if (value && !isValidShortAnswer(value)) {
      setErrorFor({ answerKey, value, message: SHORT_ANSWER_COPY.incomplete });
    }
  };

  const clear = () => {
    change('');
    inputRef.current?.focus({ preventScroll: true });
  };

  // Не закрываем экранную клавиатуру между нажатием крестика и очисткой.
  const preserveFocus = (event: PointerEvent<HTMLButtonElement>) => event.preventDefault();

  return {
    inputRef,
    canClear,
    clear,
    preserveFocus,
    change,
    blur,
    error,
    errorHint,
    showInlineHint,
  };
}
