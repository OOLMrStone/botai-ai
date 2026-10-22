'use client';

import { useRef, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

interface FileUploadButtonProps {
  onAdd: (files: File[]) => void;
  onRequestAccess?: () => void;
  label: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  variant?: ComponentProps<typeof Button>['variant'];
}
export function FileUploadButton({
  onAdd,
  onRequestAccess,
  label,
  accept,
  multiple = false,
  disabled = false,
  disabledReason,
  className,
  variant,
}: FileUploadButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        disabled={disabled}
        disabledReason={disabledReason}
        className={className}
        variant={variant}
        onClick={() => (onRequestAccess ? onRequestAccess() : input.current?.click())}
      >
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        multiple={multiple}
        accept={accept}
        hidden
        onChange={(event) => {
          onAdd(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}
