import { ExpertSelect } from '@/components/expert/ExpertSelect';
import { Plus, Trash2 } from 'lucide-react';
import { FormSection } from '@/components/common/FormSection';
import { GeometryBoundaryField, GeometryToggle } from '@/components/expert/ExpertGeometryControls';
import { ExpertMathField } from '@/components/expert/ExpertMathField';
import { Button } from '@/components/ui/button';
import type { ExpertUnitCircle } from '@/config/expert';
import { EXPERT_GEOMETRY_COPY } from '@/config/expert-geometry';
import { EXPERT_UI, EXPERT_UI_COPY } from '@/config/expert-ui';
import { layout } from '@/config/layout';
import type { GridGeometryFields } from '@/hooks/use-grid-geometry';
import {
  patchGeometryItem,
  geometryCircleAngleValue,
  geometryCircleArcUsesPoint,
  removeGeometryCirclePoint,
  setGeometryCircleEndpoint,
  updateGeometryCirclePoint,
} from '@/lib/grid-geometry';

interface ExpertCircleEditorProps {
  circle: ExpertUnitCircle;
  onChange: (circle: ExpertUnitCircle) => void;
  fields: GridGeometryFields;
  allowPresentation?: boolean;
}

export function ExpertCircleEditor({
  circle,
  onChange,
  fields,
  allowPresentation = true,
}: ExpertCircleEditorProps) {
  const styles = layout.expert;
  const copy = EXPERT_UI_COPY;
  const patchCircle = (patch: Partial<ExpertUnitCircle>) => onChange({ ...circle, ...patch });
  const endpoints = circle.points.map((point) => ({ id: point.id, value: point.angle }));

  return (
    <div className={styles.editorSection}>
      <p className={styles.contactLabel}>{EXPERT_GEOMETRY_COPY.angleHint}</p>
      <FormSection title={copy.circlePoints}>
        <div className={styles.editorSection}>
          {circle.points.map((point) => {
            const angle = fields.expression(
              point.id,
              geometryCircleAngleValue(point),
              (value, label) =>
                onChange(updateGeometryCirclePoint(circle, point.id, { angle: value, label })),
            );

            return (
              <div key={point.id} className={styles.geometryCard}>
                <ExpertMathField
                  label={copy.angle}
                  value={angle.value}
                  onChange={angle.onChange}
                  onValidityChange={(ready) => fields.setMathValidity(point.id, ready)}
                />
                {angle.invalid ? (
                  <p role="status" className={styles.contactLabel}>
                    {EXPERT_GEOMETRY_COPY.invalidAngle}
                  </p>
                ) : null}
                <div className={styles.geometryPointFooter}>
                  <GeometryToggle
                    label={allowPresentation ? copy.pointSelected : copy.pointIncluded}
                    checked={point.selected}
                    onChange={(selected) =>
                      onChange(updateGeometryCirclePoint(circle, point.id, { selected }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-compact"
                    aria-label={copy.removePoint}
                    onClick={() => {
                      fields.clear(point.id);
                      circle.arcs
                        .filter((arc) => geometryCircleArcUsesPoint(arc, point))
                        .forEach((arc) => fields.clear(arc.id));
                      onChange(removeGeometryCirclePoint(circle, point.id));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={() =>
              patchCircle({
                points: [...circle.points, { ...EXPERT_UI.newCirclePoint, id: fields.createId() }],
              })
            }
          >
            <Plus aria-hidden="true" />
            {copy.addPoint}
          </Button>
        </div>
      </FormSection>
      <FormSection title={copy.arcs}>
        <div className={styles.editorSection}>
          {circle.arcs.map((arc) => (
            <div key={arc.id} className={styles.geometryCard}>
              <div className={styles.geometryRow}>
                <GeometryBoundaryField
                  label={copy.from}
                  value={arc.from}
                  pointId={arc.fromPointId}
                  fields={fields}
                  fieldKey={`${arc.id}.from`}
                  points={endpoints}
                  allowCustom={allowPresentation}
                  angles
                  onChange={(from, pointId) => {
                    if (from !== null)
                      onChange(setGeometryCircleEndpoint(circle, arc.id, 'from', from, pointId));
                  }}
                />
                <GeometryBoundaryField
                  label={copy.to}
                  value={arc.to}
                  pointId={arc.toPointId}
                  fields={fields}
                  fieldKey={`${arc.id}.to`}
                  points={endpoints}
                  allowCustom={allowPresentation}
                  angles
                  onChange={(to, pointId) => {
                    if (to !== null)
                      onChange(setGeometryCircleEndpoint(circle, arc.id, 'to', to, pointId));
                  }}
                />
                <label className={styles.inputLabel}>
                  {copy.direction}
                  <ExpertSelect
                    value={arc.direction}
                    onChange={(event) => {
                      const direction = EXPERT_UI.directions.find(
                        (option) => option.value === event.target.value,
                      )?.value;
                      if (direction)
                        patchCircle({
                          arcs: patchGeometryItem(circle.arcs, arc.id, { direction }),
                        });
                    }}
                  >
                    {EXPERT_UI.directions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </ExpertSelect>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-compact"
                  aria-label={copy.removeArc}
                  onClick={() => {
                    fields.clear(arc.id);
                    patchCircle({ arcs: circle.arcs.filter((item) => item.id !== arc.id) });
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              <GeometryToggle
                label={copy.intervalSelected}
                checked={arc.selected}
                onChange={(selected) =>
                  patchCircle({ arcs: patchGeometryItem(circle.arcs, arc.id, { selected }) })
                }
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="compact"
            disabled={!allowPresentation && endpoints.length < 2}
            disabledReason={EXPERT_GEOMETRY_COPY.needCirclePoints}
            onClick={() =>
              patchCircle({
                arcs: [
                  ...circle.arcs,
                  {
                    ...EXPERT_UI.newArc,
                    ...(!allowPresentation
                      ? {
                          from: endpoints[0]?.value ?? EXPERT_UI.newArc.from,
                          to: endpoints[1]?.value ?? EXPERT_UI.newArc.to,
                          fromPointId: endpoints[0]?.id,
                          toPointId: endpoints[1]?.id,
                          fullCircle: false,
                        }
                      : {}),
                    id: fields.createId(),
                  },
                ],
              })
            }
          >
            <Plus aria-hidden="true" />
            {copy.addArc}
          </Button>
        </div>
      </FormSection>
    </div>
  );
}
