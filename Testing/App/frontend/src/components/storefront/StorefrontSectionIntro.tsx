import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { layout } from '@/config/layout';

interface StorefrontSectionIntroProps {
  eyebrow: string;
  title: string;
  description?: string;
}

export function StorefrontSectionIntro({
  eyebrow,
  title,
  description,
}: StorefrontSectionIntroProps) {
  return (
    <div className={layout.storefront.sectionIntro}>
      <p className={layout.storefront.eyebrow}>{eyebrow}</p>
      <ScreenHeading title={title} variant="landingSection" as="h2" />
      {description ? <p className={layout.storefront.sectionDescription}>{description}</p> : null}
    </div>
  );
}
