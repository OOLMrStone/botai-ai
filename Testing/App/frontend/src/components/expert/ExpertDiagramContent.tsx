import { ExpertNumberLine } from '@/components/expert/ExpertNumberLine';
import { ExpertUnitCircle } from '@/components/expert/ExpertUnitCircle';
import { ExpertNativeNumberLine } from '@/components/expert/ExpertNativeNumberLine';
import { ExpertNativeUnitCircle } from '@/components/expert/ExpertNativeUnitCircle';
import type { ExpertDiagram } from '@/config/expert';

export function ExpertDiagramContent({ diagram }: { diagram: ExpertDiagram }) {
  switch (diagram.kind) {
    case 'number_line':
      return <ExpertNumberLine axis={diagram.axis} />;
    case 'unit_circle':
      return <ExpertUnitCircle circle={diagram.circle} />;
    case 'number_line_v2':
      return <ExpertNativeNumberLine diagram={diagram} />;
    case 'unit_circle_v2':
      return <ExpertNativeUnitCircle diagram={diagram} />;
  }
}
