import type { ReactNode } from 'react';

import { layout } from '@/config/layout';

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={layout.formSection.root}>
      <legend className={layout.formSection.legend}>{title}</legend>
      <div className={layout.formSection.content}>{children}</div>
    </fieldset>
  );
}
