import { Fragment } from 'react';

import { Wordmark } from '@/components/onboarding/Wordmark';
import { BRAND } from '@/config/brand';

interface BrandTextProps {
  text: string;
}

// Название в COPY остаётся текстом; все его вхождения получают один знак.
export function BrandText({ text }: BrandTextProps) {
  return text.split(BRAND.name).map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? <Wordmark variant="inline" /> : null}
      {part}
    </Fragment>
  ));
}
