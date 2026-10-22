import { ScreenTransition } from '@/components/onboarding/ScreenTransition';

// Template перемонтируется на каждой навигации - анимация входа проигрывается каждый раз.
export default function RegisterTemplate({ children }: { children: React.ReactNode }) {
  return <ScreenTransition>{children}</ScreenTransition>;
}
