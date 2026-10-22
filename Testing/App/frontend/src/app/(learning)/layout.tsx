import { PaywallProvider } from '@/components/paywall/PaywallProvider';
import { DevToolsSlot } from '@/components/dev/DevToolsSlot';
import { LearningFrame } from '@/components/app/LearningFrame';

export default function LearningLayout({ children }: { children: React.ReactNode }) {
  return (
    <PaywallProvider>
      <LearningFrame>{children}</LearningFrame>
      <DevToolsSlot />
    </PaywallProvider>
  );
}
