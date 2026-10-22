import { layout } from '@/config/layout';

export function ExpertGeometryFeedback({ message }: { message: string | null | undefined }) {
  if (!message) return null;

  return (
    <p role="status" className={layout.expertMath.invalid}>
      {message}
    </p>
  );
}
