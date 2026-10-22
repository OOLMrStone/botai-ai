import { Trash2 } from 'lucide-react';
import { GeometryToggle } from '@/components/expert/ExpertGeometryControls';
import { ExpertMathField } from '@/components/expert/ExpertMathField';
import { NativeGeometryChoice } from '@/components/expert/ExpertNativeGeometryControls';
import { Button } from '@/components/ui/button';
import type { ExpertNativeDiagram, ExpertNativePoint } from '@/config/expert';
import {
  EXPERT_NATIVE_EDITOR as CONFIG,
  EXPERT_NATIVE_EDITOR_COPY as COPY,
} from '@/config/expert-native-editor';
import { EXPERT_UI, EXPERT_UI_COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import type { ExpertNativeGeometryFields } from '@/hooks/use-expert-native-geometry';
import { parseExpertNativeAngle } from '@/lib/expert-native-diagram';
import {
  removeNativePoint,
  setNativePointBoundary,
  updateNativePoint,
} from '@/lib/expert-native-editor';

export function ExpertNativePointEditor({
  diagram,
  point,
  index,
  fields,
  onChange,
}: {
  diagram: ExpertNativeDiagram;
  point: ExpertNativePoint;
  index: number;
  fields: ExpertNativeGeometryFields;
  onChange: (diagram: ExpertNativeDiagram) => void;
}) {
  const styles = layout.expert;
  const circle = diagram.kind === 'unit_circle_v2';
  const unknownAngle = circle && point.value.trim() && !parseExpertNativeAngle(point.value).valid;
  const hasArcs = diagram.arcs.some((arc) => arc.from === point.id || arc.to === point.id);

  return (
    <div className={styles.geometryCard}>
      <div className={styles.geometryPointFooter}>
        <span className={styles.editorHeading}>{COPY.point(index)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-compact"
          aria-label={EXPERT_UI_COPY.removePoint}
          title={hasArcs ? COPY.pointRemovalHint : EXPERT_UI_COPY.removePoint}
          onClick={() => onChange(removeNativePoint(diagram, point.id))}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <ExpertMathField
        value={point.value}
        label={circle ? COPY.pointAngle(index) : COPY.pointValue(index)}
        onChange={(value) => fields.setPointValue(point.id, value)}
        onValidityChange={(ready) => fields.setMathValidity(CONFIG.fields.point(point.id), ready)}
      />
      {unknownAngle ? (
        <p role="status" className={styles.contactLabel}>
          {COPY.unknownAngle}
        </p>
      ) : null}
      <div className={styles.editorGrid}>
        <NativeGeometryChoice
          label={COPY.inclusion}
          value={point.included}
          options={CONFIG.inclusionOptions.filter((option) => point.bound || option.value !== null)}
          onChange={(included) => onChange(updateNativePoint(diagram, point.id, { included }))}
        />
        <NativeGeometryChoice
          label={EXPERT_UI_COPY.pointSign}
          value={point.sign ?? ''}
          options={EXPERT_UI.signs}
          onChange={(sign) =>
            onChange(updateNativePoint(diagram, point.id, { sign: sign || null }))
          }
        />
      </div>
      <GeometryToggle
        label={COPY.boundary}
        checked={point.bound === true}
        onChange={(bound) => onChange(setNativePointBoundary(diagram, point.id, bound))}
      />
    </div>
  );
}
