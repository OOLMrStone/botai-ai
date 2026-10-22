import { Trash2 } from 'lucide-react';
import { GeometryToggle } from '@/components/expert/ExpertGeometryControls';
import {
  NativeGeometryChoice,
  NativeGeometryEndpoint,
} from '@/components/expert/ExpertNativeGeometryControls';
import { Button } from '@/components/ui/button';
import type { ExpertNativeArc, ExpertNativeDiagram } from '@/config/expert';
import { EXPERT_NATIVE_EDITOR_COPY } from '@/config/expert-native-editor';
import { EXPERT_UI, EXPERT_UI_COPY as COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import {
  nativeEndpointOptions,
  removeNativeArc,
  setNativeArcDirection,
  updateNativeArc,
} from '@/lib/expert-native-editor';

export function ExpertNativeArcEditor({
  diagram,
  index,
  onChange,
}: {
  diagram: ExpertNativeDiagram;
  index: number;
  onChange: (diagram: ExpertNativeDiagram) => void;
}) {
  const arc = diagram.arcs[index];
  const circleArc = diagram.kind === 'unit_circle_v2' ? diagram.arcs[index] : null;
  const options = nativeEndpointOptions(diagram);
  const patch = (next: Partial<ExpertNativeArc>) => onChange(updateNativeArc(diagram, index, next));
  const styles = layout.expert;

  return (
    <div className={styles.geometryCard}>
      <div className={styles.editorGrid}>
        <NativeGeometryEndpoint
          label={COPY.from}
          value={arc.from}
          options={options}
          onChange={(from) => patch({ from })}
        />
        <NativeGeometryEndpoint
          label={COPY.to}
          value={arc.to}
          options={options}
          onChange={(to) => patch({ to })}
        />
      </div>
      {circleArc ? (
        <NativeGeometryChoice
          label={COPY.direction}
          value={circleArc.direction}
          options={EXPERT_UI.directions}
          onChange={(direction) => onChange(setNativeArcDirection(diagram, index, direction))}
        />
      ) : null}
      {circleArc?.full_circle ? (
        <p className={styles.contactLabel}>{EXPERT_NATIVE_EDITOR_COPY.fullCircle}</p>
      ) : null}
      <NativeGeometryChoice
        label={COPY.intervalSign}
        value={arc.sign ?? ''}
        options={EXPERT_UI.signs}
        onChange={(sign) => patch({ sign: sign || null })}
      />
      <div className={styles.geometryPointFooter}>
        <GeometryToggle
          label={COPY.intervalSelected}
          checked={arc.selected}
          onChange={(selected) => patch({ selected })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-compact"
          aria-label={circleArc ? COPY.removeArc : COPY.removeInterval}
          onClick={() => onChange(removeNativeArc(diagram, index))}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
