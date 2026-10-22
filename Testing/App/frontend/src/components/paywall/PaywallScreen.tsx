'use client';

import { Fragment } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { BillingPeriodSwitch } from '@/components/common/BillingPeriodSwitch';
import { ScreenHeading } from '@/components/onboarding/ScreenHeading';
import { Wordmark } from '@/components/onboarding/Wordmark';
import { PaywallPlanCard } from '@/components/paywall/PaywallPlanCard';
import { Button } from '@/components/ui/button';
import { layout } from '@/config/layout';
import { LEGAL_PAYWALL_LINKS } from '@/config/legal-navigation';
import { legalPath } from '@/config/onboarding-steps';
import { PAYWALL, PAYWALL_COPY as C, type PaywallEntry } from '@/config/paywall';
import { usePaywallSelection } from '@/hooks/use-paywall-selection';
import { cn } from '@/lib/utils';

export function PaywallScreen({
  entry,
  onClose,
  attach,
}: {
  entry: PaywallEntry;
  onClose: () => void;
  attach: (element: HTMLDivElement | null) => void;
}) {
  const {
    period,
    selectedId,
    expanded,
    chosen,
    checkoutUnavailable,
    selectedRef,
    actionsRef,
    listRef,
    plans,
    select,
    changePeriod,
    expand,
    continue: continueToCheckout,
  } = usePaywallSelection();
  return (
    <div className={cn(layout.paywall.screen, expanded && layout.paywall.screenExpanded)}>
      <header className={layout.paywall.topbar}>
        <Wordmark variant="compact" className={layout.paywall.brand} />
        <Button size="icon-compact" variant="ghost" aria-label={C.close} onClick={onClose}>
          <X aria-hidden="true" className={layout.paywall.icon} />
        </Button>
      </header>
      <div className={cn(layout.paywall.body, expanded && layout.paywall.bodyExpanded)}>
        <div className={cn(layout.paywall.heading, expanded && layout.paywall.headingExpanded)}>
          <ScreenHeading variant="offer" title={C[entry].title} subtitle={C[entry].subtitle} />
        </div>
        <BillingPeriodSwitch
          value={period}
          onChange={changePeriod}
          className={cn(layout.paywall.period, expanded && layout.paywall.periodExpanded)}
        />
        <div
          ref={listRef}
          id={PAYWALL.plansId}
          className={cn(layout.paywall.list, expanded && layout.paywall.listExpanded)}
          role="group"
          aria-label={C.plans}
        >
          {plans.map((plan) => (
            <PaywallPlanCard
              key={plan.id}
              plan={plan}
              period={period}
              selected={selectedId === plan.id}
              chosen={chosen}
              onSelect={() => select(plan.id)}
              ref={selectedId === plan.id ? selectedRef : undefined}
            />
          ))}
        </div>
        {!expanded ? (
          <button
            type="button"
            className={layout.paywall.other}
            aria-expanded={false}
            aria-controls={PAYWALL.plansId}
            onClick={expand}
          >
            {C.other}
            <ChevronDown aria-hidden="true" className={layout.paywall.check} />
          </button>
        ) : null}
        <div
          ref={actionsRef}
          className={cn(layout.paywall.actions, expanded && layout.paywall.actionsExpanded)}
        >
          <div className={layout.paywall.reserve}>
            <div className={layout.paywall.anchor}>
              <div ref={attach} className={layout.paywall.mascot} aria-hidden="true" />
              <Button
                size="compact"
                className={layout.paywall.cta}
                onClick={continueToCheckout}
                disabledReason={C.checkoutUnavailable}
                disabled
              >
                {C.continue}
              </Button>
            </div>
          </div>
          {checkoutUnavailable ? (
            <p role="status" className={layout.paywall.checkoutNotice}>
              {C.checkoutUnavailable}
            </p>
          ) : null}
          <div className={layout.paywall.legal}>
            {LEGAL_PAYWALL_LINKS.map((link, index) => (
              <Fragment key={link.document}>
                {index > 0 ? <span aria-hidden="true">{C.legalSeparator}</span> : null}
                <a
                  className={layout.paywall.legalLink}
                  href={legalPath(link.document)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
