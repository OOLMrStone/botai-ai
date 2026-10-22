import { BrandText } from '@/components/onboarding/BrandText';
import { Plus } from 'lucide-react';

import { StorefrontSectionIntro } from '@/components/storefront/StorefrontSectionIntro';
import { layout } from '@/config/layout';
import { STOREFRONT, STOREFRONT_COPY as COPY } from '@/config/storefront';
import { cn } from '@/lib/utils';

export function StorefrontAbout() {
  return (
    <section
      id={STOREFRONT.sections.questions}
      className={cn(
        layout.storefront.container,
        layout.storefront.section,
        layout.storefront.faqGrid,
      )}
    >
      <StorefrontSectionIntro {...COPY.about} />
      <div>
        {COPY.about.questions.map((item) => (
          <details key={item.question} className={cn('group', layout.storefront.faq)}>
            <summary className={layout.storefront.faqSummary}>
              <BrandText text={item.question} />
              <Plus className={layout.storefront.faqIcon} aria-hidden />
            </summary>
            <p className={layout.storefront.faqAnswer}>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
