import { LemurPreview } from '@/components/lemur/LemurPreview';
import { LEMUR_ANIMATIONS } from '@/config/lemur-media';

export default function LemurCoolPage() {
  return <LemurPreview animation={LEMUR_ANIMATIONS.cool} />;
}
