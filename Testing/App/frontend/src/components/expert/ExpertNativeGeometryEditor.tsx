import { Plus } from 'lucide-react';
import { FormSection } from '@/components/common/FormSection';
import { ExpertDiagramContent } from '@/components/expert/ExpertDiagramContent';
import { ExpertMathField } from '@/components/expert/ExpertMathField';
import { ExpertNativeArcEditor } from '@/components/expert/ExpertNativeArcEditor';
import { ExpertNativePointEditor } from '@/components/expert/ExpertNativePointEditor';
import { ExpertRichTextEditor } from '@/components/expert/ExpertRichTextEditor';
import { Button } from '@/components/ui/button';
import { EXPERT, type ExpertNativeDiagram } from '@/config/expert';
import {
  EXPERT_NATIVE_EDITOR as CONFIG,
  EXPERT_NATIVE_EDITOR_COPY as COPY,
} from '@/config/expert-native-editor';
import { EXPERT_UI_COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import { useExpertNativeGeometry } from '@/hooks/use-expert-native-geometry';
import { addNativeArc } from '@/lib/expert-native-editor';
import { cn } from '@/lib/utils';

export function ExpertNativeGeometryEditor({
  diagram,
  onChange,
  onValidityChange,
}: {
  diagram: ExpertNativeDiagram;
  onChange: (diagram: ExpertNativeDiagram) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const fields = useExpertNativeGeometry(diagram, onChange, onValidityChange);
  const styles = layout.expert;
  const circle = diagram.kind === 'unit_circle_v2';
  const arcLimit = diagram.arcs.length >= EXPERT.nativeDiagram.maxArcs;
  const needsPoint = circle && diagram.points.length === 0;

  return (
    <div className={cn(styles.editorSection, styles.geometryClip)}>
      <div className={styles.geometryPreview} aria-label={EXPERT_UI_COPY.preview}>
        <div className={styles.geometryPreviewContent}>
          <ExpertDiagramContent diagram={diagram} />
        </div>
      </div>
      {diagram.kind === 'number_line_v2' ? (
        <>
          <FormSection title={EXPERT_UI_COPY.axisLabel}>
            <ExpertMathField
              label={EXPERT_UI_COPY.axisLabel}
              value={diagram.variable}
              onChange={fields.setVariable}
              onValidityChange={(ready) => fields.setMathValidity(CONFIG.fields.variable, ready)}
            />
          </FormSection>
          <FormSection title={COPY.note}>
            <ExpertRichTextEditor
              label={COPY.note}
              value={diagram.note ?? ''}
              onChange={fields.setNote}
              onValidityChange={(ready) => fields.setMathValidity(CONFIG.fields.note, ready)}
            />
          </FormSection>
        </>
      ) : null}
      <FormSection title={circle ? EXPERT_UI_COPY.circlePoints : EXPERT_UI_COPY.points}>
        <div className={styles.editorSection}>
          {diagram.points.map((point, index) => (
            <ExpertNativePointEditor
              key={point.id}
              diagram={diagram}
              point={point}
              index={index}
              fields={fields}
              onChange={onChange}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="compact"
            disabled={diagram.points.length >= EXPERT.nativeDiagram.maxPoints}
            disabledReason={COPY.pointLimit}
            onClick={fields.addPoint}
          >
            <Plus aria-hidden="true" />
            {EXPERT_UI_COPY.addPoint}
          </Button>
        </div>
      </FormSection>
      <FormSection title={circle ? EXPERT_UI_COPY.arcs : EXPERT_UI_COPY.intervals}>
        <div className={styles.editorSection}>
          {diagram.arcs.map((_, index) => (
            <ExpertNativeArcEditor
              key={index}
              diagram={diagram}
              index={index}
              onChange={onChange}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="compact"
            disabled={arcLimit || needsPoint}
            disabledReason={needsPoint ? COPY.needCirclePoint : COPY.arcLimit}
            onClick={() => onChange(addNativeArc(diagram))}
          >
            <Plus aria-hidden="true" />
            {circle ? EXPERT_UI_COPY.addArc : EXPERT_UI_COPY.addInterval}
          </Button>
        </div>
      </FormSection>
      {fields.structuralError ? (
        <p role="alert" className={styles.contactLabel}>
          {fields.structuralError}
        </p>
      ) : null}
    </div>
  );
}
