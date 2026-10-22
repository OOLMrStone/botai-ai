import { BILLING_COPY, STOREFRONT_PLANS } from '@/config/storefront-pricing';

export function GET() {
  const pricing = { plans: STOREFRONT_PLANS, copy: BILLING_COPY };

  return new Response(`window.BOTAI_PAYWALL_PRICING = ${JSON.stringify(pricing)};`, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  });
}
