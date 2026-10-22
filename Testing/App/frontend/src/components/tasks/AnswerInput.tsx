'use client';

import { X } from 'lucide-react';

import { ValidatedInput, type InputValidationState } from '@/components/ui/validated-input';
import { layout } from '@/config/layout';
import { SHORT_ANSWER } from '@/config/short-answer';
import { TASK_COPY } from '@/config/tasks';
import { useAnswerInput } from '@/hooks/use-answer-input';
import { cn } from '@/lib/utils';

interface AnswerInputProps {
  id: string;
  answerKey: string;
  value: string;
  validationState: InputValidationState;
  placeholder: string;
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  onValueChange: (value: string) => void;
}

export function AnswerInput({
  id,
  answerKey,
  value,
  validationState,
  placeholder,
  className,
  disabled = false,
  readOnly = false,
  onValueChange,
}: AnswerInputProps) {
  const {
    inputRef,
    clear,
    preserveFocus,
    canClear,
    change,
    blur,
    error,
    errorHint,
    showInlineHint,
  } = useAnswerInput({
    answerKey,
    value,
    disabled,
    readOnly,
    onValueChange,
  });

  return (
    <div className={layout.training.answerWrap}>
      <ValidatedInput
        ref={inputRef}
        id={id}
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        validationState={error ? 'error' : validationState}
        aria-describedby={error ? SHORT_ANSWER.errorId(id) : undefined}
        className={cn(
          layout.training.answer,
          className,
          error && layout.training.answerErrorPlaceholder,
          showInlineHint && layout.training.answerWithHint,
        )}
        placeholder={errorHint ?? placeholder}
        aria-label={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        trailingAction={
          canClear ? (
            <button
              type="button"
              className={cn(layout.validatedInput.clearAction, layout.focusRing)}
              aria-label={TASK_COPY.training.clearAnswer}
              onPointerDown={preserveFocus}
              onClick={clear}
            >
              <X aria-hidden="true" className={layout.validatedInput.clearIcon} />
            </button>
          ) : undefined
        }
        onChange={(event) => change(event.target.value)}
        onBlur={blur}
      />
      {showInlineHint ? (
        <span aria-hidden="true" className={layout.training.answerHint}>
          {errorHint}
        </span>
      ) : null}
      {error ? (
        <p id={SHORT_ANSWER.errorId(id)} role="status" className={layout.training.answerError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
