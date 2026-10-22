import { LegalLinks } from '@/components/legal/LegalLinks';
import { BrandText } from '@/components/onboarding/BrandText';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { LEGAL_COPY, LEGAL_DOCUMENTS } from '@/config/legal';
import { layout } from '@/config/layout';

export function LegalDocument({ document }: { document: (typeof LEGAL_DOCUMENTS)[number] }) {
  return (
    <>
      <div className={layout.legal.intro}>
        <ScreenHeading title={document.title} subtitle={document.summary} variant="app" />
        <p className={layout.storefront.helper}>{LEGAL_COPY.updatedAt}</p>
      </div>
      {document.sections.map((section) => (
        <section key={section.title} className={layout.legal.section}>
          <ScreenHeading title={section.title} variant="landingCard" as="h2" />
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className={layout.legal.paragraph}>
              <BrandText text={paragraph} />
            </p>
          ))}
        </section>
      ))}
      <LegalLinks />
    </>
  );
}
