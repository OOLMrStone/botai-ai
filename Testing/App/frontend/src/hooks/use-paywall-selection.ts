'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { PAYWALL, PAYWALL_PLANS, type PaywallPeriod, type PaywallPlan } from '@/config/paywall';
import { QUIZ_MOTION } from '@/config/quiz-motion';

export function usePaywallSelection() {
  const [period, setPeriod] = useState<PaywallPeriod>(PAYWALL.initialPeriod);
  const [selectedId, setSelectedId] = useState<PaywallPlan['id']>(PAYWALL.initialPlan);
  const [expanded, setExpanded] = useState(false);
  const [chosen, setChosen] = useState(false);
  const [checkoutUnavailable, setCheckoutUnavailable] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const positions = useRef<number[] | null>(null);

  function select(id: PaywallPlan['id']) {
    setSelectedId(id);
    setChosen(true);
    setCheckoutUnavailable(false);
  }
  function changePeriod(value: PaywallPeriod) {
    setPeriod(value);
    setCheckoutUnavailable(false);
  }
  function expand() {
    positions.current = [selectedRef.current, actionsRef.current].map(
      (element) => element?.getBoundingClientRect().top ?? 0,
    );
    setExpanded(true);
  }
  useLayoutEffect(() => {
    if (!expanded || !positions.current) return;
    selectedRef.current?.focus({ preventScroll: true });
    const animations: Animation[] = [];
    if (!window.matchMedia(QUIZ_MOTION.reducedMotionQuery).matches) {
      [selectedRef.current, actionsRef.current].forEach((element, index) => {
        if (!element) return;
        const offset = positions.current![index] - element.getBoundingClientRect().top;
        animations.push(
          element.animate(
            [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
            PAYWALL.motion,
          ),
        );
      });
      listRef.current?.querySelectorAll(PAYWALL.planSelector).forEach((element) => {
        if (element === selectedRef.current) return;
        animations.push(
          element.animate(
            [
              { opacity: 0, transform: `translateY(${PAYWALL.motion.offset}px)` },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { ...PAYWALL.motion, fill: 'backwards' },
          ),
        );
      });
    }
    positions.current = null;
    return () => animations.forEach((animation) => animation.cancel());
  }, [expanded]);

  return {
    period,
    selectedId,
    expanded,
    chosen,
    checkoutUnavailable,
    selectedRef,
    actionsRef,
    listRef,
    plans: expanded ? PAYWALL_PLANS : PAYWALL_PLANS.filter((plan) => plan.id === selectedId),
    select,
    changePeriod,
    expand,
    continue: () => setCheckoutUnavailable(true),
  };
}
