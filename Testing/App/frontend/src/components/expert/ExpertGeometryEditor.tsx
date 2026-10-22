import { ExpertDiagramContent } from '@/components/expert/ExpertDiagramContent';
import { ExpertCircleEditor } from '@/components/expert/ExpertCircleEditor';
import { ExpertNumberLineEditor } from '@/components/expert/ExpertNumberLineEditor';
import { ExpertNativeGeometryEditor } from '@/components/expert/ExpertNativeGeometryEditor';
import type { ExpertDiagram, ExpertNumericDiagram } from '@/config/expert';
import { EXPERT_GEOMETRY_COPY } from '@/config/expert-geometry';
import { EXPERT_UI_COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { useGridGeometry } from '@/hooks/use-grid-geometry';
import { cn } from '@/lib/utils';

interface ExpertGeometryEditorProps {
  diagram: ExpertDiagram;
  onChange: (diagram: ExpertDiagram) => void;
  onValidityChange?: (valid: boolean) => void;
  allowPresentation?: boolean;
}

export function ExpertGeometryEditor({ diagram, ...props }: ExpertGeometryEditorProps) {
  return diagram.kind === 'number_line_v2' || diagram.kind === 'unit_circle_v2' ? (
    <ExpertNativeGeometryEditor diagram={diagram} {...props} />
  ) : (
    <ExpertNumericGeometryEditor diagram={diagram} {...props} />
  );
}

function ExpertNumericGeometryEditor({
  diagram,
  onChange,
  onValidityChange,
  allowPresentation = true,
}: Omit<ExpertGeometryEditorProps, 'diagram'> & { diagram: ExpertNumericDiagram }) {
  const points = diagram.kind === 'number_line' ? diagram.axis.points : diagram.circle.points;
  const fields = useGridGeometry(
    points.map((point) => point.id),
    onValidityChange,
  );

  return (
    <div className={cn(layout.expert.editorSection, layout.expert.geometryClip)}>
      <div className={layout.expert.geometryPreview} aria-label={EXPERT_UI_COPY.preview}>
        <div className={layout.expert.geometryPreviewContent}>
          <ExpertDiagramContent diagram={diagram} />
        </div>
      </div>
      {diagram.kind === 'number_line' ? (
        <ExpertNumberLineEditor
          axis={diagram.axis}
          fields={fields}
          allowPresentation={allowPresentation}
          onChange={(axis) => onChange({ ...diagram, axis })}
        />
      ) : (
        <ExpertCircleEditor
          circle={diagram.circle}
          fields={fields}
          allowPresentation={allowPresentation}
          onChange={(circle) => onChange({ ...diagram, circle })}
        />
      )}
      {!fields.numbersValid ? (
        <p role="alert" className={layout.expert.contactLabel}>
          {EXPERT_GEOMETRY_COPY.incomplete}
        </p>
      ) : null}
    </div>
  );
}
