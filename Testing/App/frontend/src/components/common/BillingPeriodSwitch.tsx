'use client';

import { layout } from '@/config/layout';
import {
  BILLING_COPY,
  STOREFRONT_PERIODS,
  type StorefrontPeriod,
} from '@/config/storefront-pricing';
import { cn } from '@/lib/utils';

export function BillingPeriodSwitch({
  value,
  onChange,
  className,
}: {
  value: StorefrontPeriod;
  onChange: (value: StorefrontPeriod) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(layout.billingPeriod.root, className)}
      role="group"
      aria-label={BILLING_COPY.periodLabel}
    >
      <span
        aria-hidden="true"
        className={cn(
          layout.billingPeriod.indicator,
          value === 'season' && layout.billingPeriod.season,
        )}
      />
      {STOREFRONT_PERIODS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cn(
            layout.billingPeriod.button,
            value === option.id && layout.billingPeriod.selected,
          )}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
