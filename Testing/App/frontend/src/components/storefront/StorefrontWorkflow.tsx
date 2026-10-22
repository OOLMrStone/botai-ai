import { EmbeddedBo } from '@/components/lemur/EmbeddedBo';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { StorefrontSectionIntro } from '@/components/storefront/StorefrontSectionIntro';
import { layout } from '@/config/layout';
import { LANDING_BO } from '@/config/landing-bo';
import { STOREFRONT, STOREFRONT_COPY as COPY } from '@/config/storefront';
import { cn } from '@/lib/utils';

export function StorefrontWorkflow() {
  return (
    <section
      id={STOREFRONT.sections.workflow}
      className={cn(layout.storefront.section, layout.storefront.warmSection)}
    >
      <div className={layout.storefront.container}>
        <StorefrontSectionIntro {...COPY.workflow} />
        <p className={layout.storefront.swipeHint}>{COPY.workflow.swipeHint}</p>
        <div className={layout.storefront.workflow}>
          {COPY.workflow.steps.map((step) => (
            <article key={step.id} className={layout.storefront.workflowStep}>
              <EmbeddedBo
                animation={LANDING_BO[step.id]}
                className={layout.storefront.workflowBo}
              />
              <div className={layout.storefront.workflowCopy}>
                <span className={layout.storefront.stepNumber}>{step.number}</span>
                <ScreenHeading as="h3" variant="landingCard" title={step.title} />
                <p className={layout.storefront.helper}>{step.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
